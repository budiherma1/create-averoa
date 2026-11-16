import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { run } from '../src/cli.js';
import {
  collector, FIXTURE, readJson, tempDir, testIo,
} from './helpers.js';

const BIN = fileURLToPath(new URL('../bin/create-averoa.js', import.meta.url));
const hasGit = spawnSync('git', ['--version']).status === 0;
const isWindows = process.platform === 'win32';
const offline = ['--template', FIXTURE, '--no-install', '--no-git'];

/** A fake `npm` on PATH that records its arguments and exits with `code`. */
function fakeNpm(t, code = 0) {
  const bin = tempDir(t);
  const log = path.join(bin, 'calls.log');
  fs.writeFileSync(path.join(bin, 'npm'), `#!/bin/sh\necho "$PWD $*" >> "${log}"\nexit ${code}\n`, { mode: 0o755 });
  return { PATH: `${bin}${path.delimiter}${process.env.PATH}`, log };
}

/** Git configuration isolated from the user's: an identity, or none. */
function gitEnv(t, identity = true) {
  const home = tempDir(t);
  const config = path.join(home, '.gitconfig');
  fs.writeFileSync(config, identity ? '[user]\n\tname = Test\n\temail = test@example.com\n' : '');
  return {
    HOME: home, GIT_CONFIG_GLOBAL: config, GIT_CONFIG_NOSYSTEM: '1',
  };
}

describe('create-averoa', () => {
  it('creates an application from a local template', async (t) => {
    const cwd = tempDir(t);
    const io = testIo(cwd);
    const code = await run(['my-app', ...offline], io);
    assert.equal(code, 0, io.stderr.text());

    const app = path.join(cwd, 'my-app');
    assert.equal(readJson(path.join(app, 'package.json')).name, 'my-app');
    assert.match(fs.readFileSync(path.join(app, '.env'), 'utf8'), /^TOKEN_SECRET=[0-9a-f]{128}$/m);
    assert.equal(fs.existsSync(path.join(app, 'scripts')), false);
    assert.equal(fs.existsSync(path.join(app, '.git')), false);

    const out = io.stdout.text();
    assert.match(out, /Creating my-app in /);
    assert.match(out, /Removed repository-only files: scripts\/link-local\.mjs, CHANGELOG\.md, LICENSE, \.github, npm script link:local/);
    assert.match(out, /Added better-sqlite3@\^12\.4\.1 to dependencies/);
    assert.match(out, /cd my-app\n {2}npm install\n {2}npm run migrate:up\n {2}npm run seed:run\n {2}npm run dev/);
    assert.match(out, /http:\/\/localhost:8888\/api/);
    assert.equal(io.stderr.text(), '');
  });

  it('runs through bin/create-averoa.js', (t) => {
    const cwd = tempDir(t);
    const out = execFileSync(process.execPath, [BIN, 'bin-app', '--db', 'postgres', '--pm', 'pnpm', ...offline], {
      cwd, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    assert.match(out, /pnpm install\n {2}# create the database "bin_app" and set DB_USER \/ DB_PASS in \.env\n {2}pnpm run migrate:up/);
    const app = path.join(cwd, 'bin-app');
    assert.equal(fs.existsSync(path.join(app, 'package-lock.json')), false);
    assert.equal(readJson(path.join(app, 'package.json')).dependencies.pg, '^8.23.1');
    assert.match(fs.readFileSync(path.join(app, '.env'), 'utf8'), /^DB_CLIENT=pg$/m);
  });

  it('reads the template from CREATE_AVEROA_TEMPLATE', async (t) => {
    const cwd = tempDir(t);
    const io = testIo(cwd, { CREATE_AVEROA_TEMPLATE: FIXTURE });
    assert.equal(await run(['env-app', '--no-install', '--no-git'], io), 0, io.stderr.text());
    assert.match(io.stdout.text(), new RegExp(`Template: ${FIXTURE.replace(/[\\.]/g, '\\$&')}`));
  });

  it('refuses a directory that is not empty', async (t) => {
    const cwd = tempDir(t);
    const app = path.join(cwd, 'taken');
    fs.mkdirSync(app);
    fs.writeFileSync(path.join(app, 'notes.txt'), 'mine');
    const io = testIo(cwd);
    assert.equal(await run(['taken', ...offline], io), 1);
    assert.match(io.stderr.text(), /taken is not empty\. Choose another directory, or pass --force/);
    assert.deepEqual(fs.readdirSync(app), ['notes.txt'], 'nothing was written');
  });

  it('refuses the current directory when it is not empty', async (t) => {
    const cwd = tempDir(t);
    fs.writeFileSync(path.join(cwd, 'x'), '');
    const io = testIo(cwd);
    assert.equal(await run(['.', '--name', 'here', ...offline], io), 1);
    assert.match(io.stderr.text(), /\. is not empty/);
  });

  it('treats a folder with only .git as empty', async (t) => {
    const cwd = tempDir(t);
    fs.mkdirSync(path.join(cwd, 'repo', '.git'), { recursive: true });
    const io = testIo(cwd);
    assert.equal(await run(['repo', ...offline], io), 0, io.stderr.text());
  });

  it('writes into a non-empty directory with --force and keeps an existing .env', async (t) => {
    const cwd = tempDir(t);
    const app = path.join(cwd, 'forced');
    fs.mkdirSync(app);
    fs.writeFileSync(path.join(app, 'notes.txt'), 'mine');
    fs.writeFileSync(path.join(app, '.env'), 'TOKEN_SECRET=keep-me\n');
    fs.writeFileSync(path.join(app, 'server.js'), 'old');
    const io = testIo(cwd);
    assert.equal(await run(['forced', '--force', ...offline], io), 0, io.stderr.text());
    assert.equal(fs.readFileSync(path.join(app, 'notes.txt'), 'utf8'), 'mine');
    assert.equal(fs.readFileSync(path.join(app, '.env'), 'utf8'), 'TOKEN_SECRET=keep-me\n');
    assert.notEqual(fs.readFileSync(path.join(app, 'server.js'), 'utf8'), 'old');
    assert.match(io.stderr.text(), /\.env already exists and was kept/);
  });

  it('refuses a target that is a file', async (t) => {
    const cwd = tempDir(t);
    fs.writeFileSync(path.join(cwd, 'file'), '');
    const io = testIo(cwd);
    assert.equal(await run(['file', ...offline], io), 1);
    assert.match(io.stderr.text(), /exists and is not a directory/);
  });

  it('suggests a valid package name for the directory', async (t) => {
    const cwd = tempDir(t);
    const io = testIo(cwd);
    assert.equal(await run(['My Shop', ...offline], io), 0, io.stderr.text());
    assert.match(io.stdout.text(), /"My Shop" is not a valid npm package name; using "my-shop"/);
    assert.match(io.stdout.text(), /cd "My Shop"/);
    assert.equal(readJson(path.join(cwd, 'My Shop', 'package.json')).name, 'my-shop');
  });

  it('uses --name and rejects an invalid one', async (t) => {
    const cwd = tempDir(t);
    let io = testIo(cwd);
    assert.equal(await run(['api', '--name', '@acme/api', ...offline], io), 0, io.stderr.text());
    assert.equal(readJson(path.join(cwd, 'api', 'package.json')).name, '@acme/api');

    io = testIo(cwd);
    assert.equal(await run(['other', '--name', 'Bad Name', ...offline], io), 1);
    assert.match(io.stderr.text(), /Invalid --name "Bad Name"/);
    assert.equal(fs.existsSync(path.join(cwd, 'other')), false);
  });

  it('defaults to averoa-app without a directory', async (t) => {
    const cwd = tempDir(t);
    const io = testIo(cwd);
    assert.equal(await run([...offline], io), 0, io.stderr.text());
    assert.ok(fs.existsSync(path.join(cwd, 'averoa-app', 'package.json')));
  });

  it('prints usage errors and help', async (t) => {
    const io = testIo(tempDir(t));
    assert.equal(await run(['--db', 'oracle'], io), 1);
    assert.match(io.stderr.text(), /Unknown --db "oracle"/);
    const help = testIo(tempDir(t));
    assert.equal(await run(['--help'], help), 0);
    assert.match(help.stdout.text(), /Usage: create-averoa/);
  });

  it('reports a failed download', async (t) => {
    const cwd = tempDir(t);
    const io = testIo(cwd);
    assert.equal(await run(['net-app', '--ref', 'v2.1.0', '--no-install', '--no-git'], io), 1);
    assert.match(io.stderr.text(), /could not download https:\/\/codeload\.github\.com\/budiherma1\/averoajs\/tar\.gz\/v2\.1\.0/);
    assert.equal(fs.existsSync(path.join(cwd, 'net-app')), false, 'nothing was written');
  });

  it('installs dependencies and creates a git repository by default', { skip: (isWindows || !hasGit) && 'needs a POSIX shell and git' }, async (t) => {
    const cwd = tempDir(t);
    const npm = fakeNpm(t);
    const io = testIo(cwd, { ...gitEnv(t), PATH: npm.PATH });
    assert.equal(await run(['full-app', '--template', FIXTURE], io), 0, io.stderr.text());

    const app = path.join(cwd, 'full-app');
    assert.equal(fs.readFileSync(npm.log, 'utf8').trim(), `${app} install`);
    const git = (...args) => execFileSync('git', args, { cwd: app, encoding: 'utf8', env: io.env }).trim();
    assert.equal(git('log', '--format=%s'), 'Initial commit from create-averoa');
    const files = git('ls-files').split('\n');
    assert.ok(files.includes('package.json'));
    assert.ok(files.includes('.env.example'));
    assert.equal(files.includes('.env'), false, '.env is git-ignored');
    const out = io.stdout.text();
    assert.match(out, /Created a git repository with an initial commit/);
    assert.doesNotMatch(out, / {2}npm install\n/, 'no install step left');
  });

  it('uses the package manager from npm_config_user_agent', { skip: isWindows && 'needs a POSIX shell' }, async (t) => {
    const cwd = tempDir(t);
    const bin = tempDir(t);
    const log = path.join(bin, 'calls.log');
    fs.writeFileSync(path.join(bin, 'pnpm'), `#!/bin/sh\necho "pnpm $*" >> "${log}"\n`, { mode: 0o755 });
    const io = testIo(cwd, {
      PATH: `${bin}${path.delimiter}${process.env.PATH}`, npm_config_user_agent: 'pnpm/9.15.0 npm/? node/v22.12.0 linux x64',
    });
    assert.equal(await run(['pnpm-app', '--template', FIXTURE, '--no-git'], io), 0, io.stderr.text());
    assert.equal(fs.readFileSync(log, 'utf8').trim(), 'pnpm install');
    assert.match(io.stdout.text(), /pnpm run dev/);
    assert.equal(fs.existsSync(path.join(cwd, 'pnpm-app', 'package-lock.json')), false);
  });

  it('exits with 1 when the install fails, keeping the files', { skip: isWindows && 'needs a POSIX shell' }, async (t) => {
    const cwd = tempDir(t);
    const io = testIo(cwd, { PATH: fakeNpm(t, 3).PATH });
    assert.equal(await run(['broken', '--template', FIXTURE, '--no-git'], io), 1);
    assert.match(io.stderr.text(), /npm install failed \(exit code 3\)/);
    assert.match(io.stdout.text(), / {2}npm install\n/);
    assert.ok(fs.existsSync(path.join(cwd, 'broken', 'package.json')));
  });

  it('skips git when user.name / user.email are not configured', { skip: !hasGit && 'git is not installed' }, async (t) => {
    const cwd = tempDir(t);
    const io = testIo(cwd, gitEnv(t, false));
    assert.equal(await run(['no-id', '--template', FIXTURE, '--no-install', '--git'], io), 0, io.stderr.text());
    assert.match(io.stdout.text(), /Skipped git: git user\.name \/ user\.email are not configured/);
    assert.equal(fs.existsSync(path.join(cwd, 'no-id', '.git')), false);
  });

  it('skips git inside an existing repository', { skip: !hasGit && 'git is not installed' }, async (t) => {
    const cwd = tempDir(t);
    const env = gitEnv(t);
    execFileSync('git', ['init', '-q'], { cwd, env: { ...process.env, ...env } });
    const io = testIo(cwd, env);
    assert.equal(await run(['packages/api', '--template', FIXTURE, '--no-install'], io), 0, io.stderr.text());
    assert.match(io.stdout.text(), /Skipped git: the directory is already inside a git repository/);
    assert.equal(readJson(path.join(cwd, 'packages', 'api', 'package.json')).name, 'api');
  });

  /** A fake terminal that types each answer once its question is printed. */
  function terminal(cwd, answers) {
    const stdin = new PassThrough();
    stdin.isTTY = true;
    stdin.setRawMode = () => stdin;
    const stdout = collector();
    stdout.isTTY = true;
    stdout.columns = 80;
    let seen = 0;
    const write = stdout.write.bind(stdout);
    stdout.write = (chunk, ...rest) => {
      const result = write(chunk, ...rest);
      const text = stdout.text().slice(seen);
      if (answers.length && answers[0][0].test(text)) {
        seen = stdout.text().length;
        const [, answer] = answers.shift();
        setImmediate(() => stdin.write(answer));
      }
      return result;
    };
    return {
      ...testIo(cwd, { NO_COLOR: '1' }), stdin, stdout, stderr: collector(),
    };
  }

  it('asks before writing into a non-empty directory on a terminal', async (t) => {
    const cwd = tempDir(t);
    fs.mkdirSync(path.join(cwd, 'busy'));
    fs.writeFileSync(path.join(cwd, 'busy', 'notes.txt'), '');
    const answers = [[/busy is not empty\. Write into it anyway\? .*\(y\/N\) $/, '\r']];
    const io = terminal(cwd, answers);
    assert.equal(await run(['busy', '--template', FIXTURE, '--db', 'sqlite', '--no-install', '--no-git'], io), 130);
    assert.equal(answers.length, 0);
    assert.match(io.stderr.text(), /Cancelled\. Nothing was written\./);
    assert.deepEqual(fs.readdirSync(path.join(cwd, 'busy')), ['notes.txt']);
  });

  it('cancels on Ctrl+C', async (t) => {
    const cwd = tempDir(t);
    const io = terminal(cwd, [[/Project directory \(averoa-app\): $/, '\u0003']]);
    assert.equal(await run(['--template', FIXTURE], io), 130);
    assert.deepEqual(fs.readdirSync(cwd), []);
  });

  it('asks for the missing answers on a terminal', async (t) => {
    const cwd = tempDir(t);
    const answers = [
      [/Project directory \(averoa-app\): $/, 'Prompt App'],
      [/Package name \(prompt-app\): $/, 'Bad Name'],
      [/Package name \(prompt-app\): $/, ''],
      [/Choose 1-3 \(1\): $/, '2'],
      [/Install dependencies with npm\? \(Y\/n\) $/, 'n'],
      [/Initialise a git repository\? \(Y\/n\) $/, 'no'],
    ].map(([question, answer]) => [question, `${answer}\r`]);
    const io = terminal(cwd, answers);
    const { stdout } = io;
    const code = await run(['--template', FIXTURE], io);
    assert.equal(code, 0, io.stderr.text());
    assert.equal(answers.length, 0, 'every question was asked');
    assert.match(stdout.text(), /Invalid package name: name must be lowercase/);
    const app = path.join(cwd, 'Prompt App');
    assert.equal(readJson(path.join(app, 'package.json')).name, 'prompt-app');
    assert.match(fs.readFileSync(path.join(app, '.env'), 'utf8'), /^DB_CLIENT=mysql2$/m);
    assert.equal(fs.existsSync(path.join(app, '.git')), false);
  });
});
