import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  normalizeDb, parseArgs, UsageError, validateRef,
} from '../src/args.js';

describe('parseArgs', () => {
  it('returns the defaults for no arguments', () => {
    assert.deepEqual(parseArgs([]), {
      dir: undefined,
      name: undefined,
      db: undefined,
      ref: undefined,
      template: undefined,
      pm: undefined,
      install: undefined,
      git: undefined,
      force: false,
      yes: false,
      help: false,
      version: false,
    });
  });

  it('reads the project directory and every option', () => {
    const opts = parseArgs([
      'my-app', '--db', 'mysql', '--ref=v2.1.0', '--name', '@acme/api', '--pm', 'pnpm',
      '--no-install', '--git', '-f', '-y',
    ]);
    assert.equal(opts.dir, 'my-app');
    assert.equal(opts.db, 'mysql');
    assert.equal(opts.ref, 'v2.1.0');
    assert.equal(opts.name, '@acme/api');
    assert.equal(opts.pm, 'pnpm');
    assert.equal(opts.install, false);
    assert.equal(opts.git, true);
    assert.equal(opts.force, true);
    assert.equal(opts.yes, true);
  });

  it('lets the last of --install / --no-install win', () => {
    assert.equal(parseArgs(['--no-install', '--install']).install, true);
    assert.equal(parseArgs(['--git', '--no-git']).git, false);
  });

  it('accepts options before the directory and after --', () => {
    assert.equal(parseArgs(['--yes', 'app']).dir, 'app');
    assert.equal(parseArgs(['--', '--weird-dir']).dir, '--weird-dir');
  });

  it('reads --template from both forms', () => {
    assert.equal(parseArgs(['--template', './tpl']).template, './tpl');
    assert.equal(parseArgs(['--template=./a=b.tgz']).template, './a=b.tgz');
  });

  it('maps database aliases', () => {
    for (const [input, db] of [['sqlite', 'sqlite'], ['better-sqlite3', 'sqlite'], ['mysql2', 'mysql'],
      ['MariaDB', 'mysql'], ['pg', 'postgres'], ['postgresql', 'postgres']]) {
      assert.equal(normalizeDb(input), db);
    }
    assert.equal(parseArgs(['--db=pg']).db, 'postgres');
  });

  it('sets help and version', () => {
    assert.equal(parseArgs(['-h']).help, true);
    assert.equal(parseArgs(['--version']).version, true);
  });

  const invalid = [
    [['--bogus'], /Unknown option "--bogus"/],
    [['-x'], /Unknown option "-x"/],
    [['a', 'b'], /one project directory/],
    [['--db'], /--db needs a value/],
    [['--db', '--yes'], /--db needs a value/],
    [['--db='], /--db needs a value/],
    [['--db', 'oracle'], /Unknown --db "oracle"/],
    [['--pm', 'deno'], /Unknown --pm "deno"/],
    [['--yes=1'], /does not take a value/],
    [['--ref', 'v1', '--template', 'x'], /either --ref or --template/],
  ];
  for (const [argv, message] of invalid) {
    it(`rejects ${argv.join(' ')}`, () => {
      assert.throws(() => parseArgs(argv), (err) => err instanceof UsageError && message.test(err.message));
    });
  }
});

describe('validateRef', () => {
  it('accepts tags, branches and SHAs', () => {
    for (const ref of ['v2.1.0', 'master', 'feat/create', '06ab4d80a4406a7f05c995f5293accbfca7ab96c']) {
      assert.equal(validateRef(ref), ref);
    }
  });

  it('rejects anything that could change the download URL', () => {
    for (const ref of ['../evil', 'a b', 'v1?x=1', '/abs', '-rf', 'a%2f', 'x#y']) {
      assert.throws(() => validateRef(ref), UsageError, ref);
    }
  });
});
