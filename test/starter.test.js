import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  applyStarter, listStarters, readStarter, resolveStarter,
} from '../src/starter.js';
import { postProcess } from '../src/scaffold.js';
import { fixtureCopy } from './helpers.js';

const write = (root, rel, content) => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), typeof content === 'string' ? content : JSON.stringify(content));
};
const exists = (root, rel) => fs.existsSync(path.join(root, rel));
const read = (root, rel) => fs.readFileSync(path.join(root, rel), 'utf8');

/** The fixture boilerplate with a `slim` starter and a `panel` starter that extends it. */
function withStarters(t) {
  const root = fixtureCopy(t);
  write(root, 'app/Models/Teacher.js', 'export default class Teacher {}\n');
  write(root, 'routes/v2/index.js', 'export default () => {};\n');
  write(root, 'routes/api.js', '// full\n');
  write(root, '.env.example', 'APP_PORT=8888\nDB_CLIENT=mysql2\n');
  write(root, 'starters/slim/starter.json', {
    description: 'No examples',
    remove: ['app/Models/Teacher.js', 'routes/v2', 'not/there.js'],
  });
  write(root, 'starters/slim/files/routes/api.js', '// slim\n');
  write(root, 'starters/panel/starter.json', {
    description: 'Admin pages',
    extends: 'slim',
    dependencies: { 'panel-lib': '^1.2.0' },
    scripts: { 'panel:build': 'node build.js' },
    env: { PANEL_TITLE: 'Admin', APP_PORT: '9999' },
  });
  write(root, 'starters/panel/files/routes/api.js', '// panel\n');
  write(root, 'starters/panel/files/resources/views/dashboard/home.edge', '<h1>Home</h1>\n');
  write(root, 'starters/Bad_Name/starter.json', {});
  return root;
}

describe('starters', () => {
  it('lists the starters of a boilerplate (none for an older one)', (t) => {
    const root = withStarters(t);
    assert.deepEqual(listStarters(root), [
      { name: 'panel', description: 'Admin pages' },
      { name: 'slim', description: 'No examples' },
    ]);
    assert.deepEqual(listStarters(fixtureCopy(t)), []);
  });

  it('applies a starter after the ones it extends', (t) => {
    const root = withStarters(t);
    const result = applyStarter(root, 'panel');
    assert.deepEqual(result.chain, ['slim', 'panel']);
    assert.deepEqual(result.removed, ['app/Models/Teacher.js', 'routes/v2']);
    assert.equal(exists(root, 'app/Models/Teacher.js'), false);
    assert.equal(exists(root, 'routes/v2'), false);
    assert.equal(read(root, 'routes/api.js'), '// panel\n', 'the extending starter wins');
    assert.equal(read(root, 'resources/views/dashboard/home.edge'), '<h1>Home</h1>\n');
    assert.deepEqual(result.packages, ['panel-lib@^1.2.0']);

    const pkg = JSON.parse(read(root, 'package.json'));
    assert.equal(pkg.dependencies['panel-lib'], '^1.2.0');
    assert.deepEqual(Object.keys(pkg.dependencies), Object.keys(pkg.dependencies).sort());
    assert.equal(pkg.scripts['panel:build'], 'node build.js');
    assert.equal(read(root, '.env.example'), 'APP_PORT=9999\nDB_CLIENT=mysql2\nPANEL_TITLE=Admin\n');
  });

  it('postProcess drops the starters folder and names the starter in the README', (t) => {
    const root = withStarters(t);
    applyStarter(root, 'slim');
    postProcess(root, {
      name: 'my-app', db: 'sqlite', ref: 'v2.5.0', starter: 'slim', secret: () => 's',
    });
    assert.equal(exists(root, 'starters'), false);
    assert.match(read(root, 'README.md'), /AveroaJS v2\.5\.0 \(starter: slim\)/);
    assert.match(read(root, '.env'), /^APP_PORT=8888$/m);
  });

  it('returns null for an unknown starter, and rejects bad manifests', (t) => {
    const root = withStarters(t);
    assert.equal(applyStarter(root, 'nope'), null);
    assert.throws(() => readStarter(root, '../slim'), /Invalid starter name/);

    write(root, 'starters/evil/starter.json', { remove: ['../outside'] });
    assert.throws(() => applyStarter(root, 'evil'), /not a relative path inside the app/);
    write(root, 'starters/evil/starter.json', { remove: ['/etc/passwd'] });
    assert.throws(() => applyStarter(root, 'evil'), /not a relative path/);
    write(root, 'starters/evil/starter.json', { typo: true });
    assert.throws(() => readStarter(root, 'evil'), /unknown key "typo"/);
    write(root, 'starters/evil/starter.json', { env: { 'bad key': 'x' } });
    assert.throws(() => readStarter(root, 'evil'), /invalid name "bad key"/);
    write(root, 'starters/evil/starter.json', '{ not json');
    assert.throws(() => readStarter(root, 'evil'), /not valid JSON/);
  });

  it('detects extends cycles and missing parents', (t) => {
    const root = withStarters(t);
    write(root, 'starters/a/starter.json', { extends: 'b' });
    write(root, 'starters/b/starter.json', { extends: 'a' });
    assert.throws(() => resolveStarter(root, 'a'), /extends itself \(a -> b -> a\)/);
    write(root, 'starters/c/starter.json', { extends: 'missing' });
    assert.throws(() => resolveStarter(root, 'c'), /"c" extends "missing", which does not exist/);
  });

  it('rejects symlinks in the files of a starter', (t) => {
    const root = withStarters(t);
    fs.symlinkSync('/tmp', path.join(root, 'starters/slim/files/link'));
    assert.throws(() => applyStarter(root, 'slim'), /only contain regular files/);
  });
});
