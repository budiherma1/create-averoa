import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  dbEnv, postProcess, projectReadme, REPO_ONLY_FILES, setEnvValue,
} from '../src/scaffold.js';
import { fixtureCopy, readJson } from './helpers.js';

const secrets = () => {
  let n = 0;
  return () => {
    n += 1;
    return `secret-${n}`;
  };
};

describe('setEnvValue', () => {
  it('replaces the existing line', () => {
    assert.equal(setEnvValue('A=1\nKEY=\nB=2\n', 'KEY', 'x'), 'A=1\nKEY=x\nB=2\n');
  });

  it('leaves commented lines and similar keys alone', () => {
    assert.equal(setEnvValue('# KEY=old\nMY_KEY=1\nKEY=2\n', 'KEY', 'x'), '# KEY=old\nMY_KEY=1\nKEY=x\n');
  });

  it('appends a missing key', () => {
    assert.equal(setEnvValue('A=1', 'KEY', 'x'), 'A=1\nKEY=x\n');
    assert.equal(setEnvValue('', 'KEY', 'x'), 'KEY=x\n');
  });

  it('does not interpret $ in the value', () => {
    assert.equal(setEnvValue('KEY=\n', 'KEY', 'a$&b$1'), 'KEY=a$&b$1\n');
  });
});

describe('dbEnv', () => {
  it('has a preset per database', () => {
    assert.deepEqual(dbEnv('sqlite', 'my-app'), { DB_CLIENT: 'better-sqlite3', DB_NAME: 'database/dev.sqlite' });
    assert.deepEqual(dbEnv('mysql', 'my-app'), {
      DB_CLIENT: 'mysql2', DB_HOST: '127.0.0.1', DB_PORT: '3306', DB_NAME: 'my_app',
    });
    assert.deepEqual(dbEnv('postgres', '@acme/api'), {
      DB_CLIENT: 'pg', DB_HOST: '127.0.0.1', DB_PORT: '5432', DB_NAME: 'api',
    });
    assert.throws(() => dbEnv('oracle', 'x'), /unknown database/);
  });
});

describe('postProcess', () => {
  it('turns the boilerplate into a new SQLite app', (t) => {
    const root = fixtureCopy(t);
    const result = postProcess(root, {
      name: 'my-app', db: 'sqlite', packageManager: 'npm', ref: 'v2.1.0', secret: secrets(),
    });

    const pkg = readJson(path.join(root, 'package.json'));
    assert.deepEqual(Object.keys(pkg).slice(0, 3), ['name', 'version', 'private']);
    assert.equal(pkg.name, 'my-app');
    assert.equal(pkg.version, '0.1.0');
    assert.equal(pkg.private, true);
    for (const field of ['description', 'author', 'license', 'repository']) assert.equal(pkg[field], undefined, field);
    assert.equal(pkg.scripts['link:local'], undefined);
    assert.equal(pkg.scripts.dev, 'nodemon server.js');
    // the SQLite driver is needed at runtime: moved out of devDependencies
    assert.equal(pkg.dependencies['better-sqlite3'], '^12.4.1');
    assert.equal(pkg.devDependencies['better-sqlite3'], undefined);
    assert.deepEqual(Object.keys(pkg.dependencies), ['better-sqlite3', 'express', 'mysql2']);
    assert.equal(pkg.type, 'module');
    assert.deepEqual(pkg.engines, { node: '>=20' });

    const lock = readJson(path.join(root, 'package-lock.json'));
    assert.equal(lock.name, 'my-app');
    assert.equal(lock.version, '0.1.0');
    assert.equal(lock.packages[''].name, 'my-app');
    assert.equal(lock.packages[''].license, undefined);

    for (const file of ['scripts', 'LICENSE', 'CHANGELOG.md', '.github']) {
      assert.equal(fs.existsSync(path.join(root, file)), false, file);
    }
    assert.deepEqual(result.removedFiles, ['scripts/link-local.mjs', 'CHANGELOG.md', 'LICENSE', '.github']);
    assert.deepEqual(result.removedScripts, ['link:local']);
    assert.equal(result.driver, 'better-sqlite3@^12.4.1');
    for (const file of ['.env.example', '.gitignore', 'server.js', 'app/index.js', 'storages/logs/.gitkeep']) {
      assert.ok(fs.existsSync(path.join(root, file)), file);
    }

    const env = fs.readFileSync(path.join(root, '.env'), 'utf8');
    assert.match(env, /^TOKEN_SECRET=secret-1$/m);
    assert.match(env, /^SESSION_SECRET=secret-2$/m);
    assert.match(env, /^DB_CLIENT=better-sqlite3$/m);
    assert.match(env, /^DB_NAME=database\/dev\.sqlite$/m);
    assert.match(env, /^NODE_ENV=development$/m);
    assert.match(env, /^# Required\. Secret used to sign JWTs$/m, 'comments are kept');
    if (process.platform !== 'win32') {
      assert.equal(fs.statSync(path.join(root, '.env')).mode & 0o777, 0o600);
    }

    const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
    assert.match(readme, /^# my-app$/m);
    assert.match(readme, /averoajs\/blob\/v2\.1\.0\/README\.md/);
    assert.match(readme, /npm run migrate:up/);
    assert.doesNotMatch(readme, /link:local/);
  });

  it('generates fresh 128-character hex secrets by default', (t) => {
    const root = fixtureCopy(t);
    postProcess(root, { name: 'a', db: 'sqlite' });
    const env = fs.readFileSync(path.join(root, '.env'), 'utf8');
    const token = /^TOKEN_SECRET=([0-9a-f]+)$/m.exec(env)[1];
    const session = /^SESSION_SECRET=([0-9a-f]+)$/m.exec(env)[1];
    assert.equal(token.length, 128);
    assert.equal(session.length, 128);
    assert.notEqual(token, session);
  });

  it('applies the MySQL preset', (t) => {
    const root = fixtureCopy(t);
    const result = postProcess(root, { name: '@acme/shop', db: 'mysql', secret: secrets() });
    const pkg = readJson(path.join(root, 'package.json'));
    assert.equal(result.driver, null, 'mysql2 is already a dependency');
    assert.equal(pkg.devDependencies['better-sqlite3'], '^12.4.1', 'kept for the tests');
    const env = fs.readFileSync(path.join(root, '.env'), 'utf8');
    assert.match(env, /^DB_CLIENT=mysql2$/m);
    assert.match(env, /^DB_PORT=3306$/m);
    assert.match(env, /^DB_NAME=shop$/m);
    assert.match(fs.readFileSync(path.join(root, 'README.md'), 'utf8'), /Create the database `shop`/);
  });

  it('applies the PostgreSQL preset and adds pg', (t) => {
    const root = fixtureCopy(t);
    const result = postProcess(root, { name: 'pg-app', db: 'postgres', secret: secrets() });
    const pkg = readJson(path.join(root, 'package.json'));
    assert.equal(result.driver, 'pg@^8.23.1');
    assert.equal(pkg.dependencies.pg, '^8.23.1');
    const env = fs.readFileSync(path.join(root, '.env'), 'utf8');
    assert.match(env, /^DB_CLIENT=pg$/m);
    assert.match(env, /^DB_PORT=5432$/m);
    assert.match(env, /^DB_NAME=pg_app$/m);
  });

  it('drops package-lock.json for other package managers', (t) => {
    const root = fixtureCopy(t);
    const result = postProcess(root, { name: 'p', db: 'sqlite', packageManager: 'pnpm' });
    assert.deepEqual(result.removedLockfiles, ['package-lock.json']);
    assert.equal(fs.existsSync(path.join(root, 'package-lock.json')), false);
    assert.match(fs.readFileSync(path.join(root, 'README.md'), 'utf8'), /pnpm run dev/);
  });

  it('creates .env without a .env.example', (t) => {
    const root = fixtureCopy(t);
    fs.rmSync(path.join(root, '.env.example'));
    postProcess(root, { name: 'p', db: 'sqlite', secret: secrets() });
    assert.equal(
      fs.readFileSync(path.join(root, '.env'), 'utf8'),
      'TOKEN_SECRET=secret-1\nSESSION_SECRET=secret-2\nDB_CLIENT=better-sqlite3\nDB_NAME=database/dev.sqlite\n',
    );
  });

  it('keeps a scripts folder that has other files', (t) => {
    const root = fixtureCopy(t);
    fs.writeFileSync(path.join(root, 'scripts', 'deploy.sh'), '');
    postProcess(root, { name: 'p', db: 'sqlite' });
    assert.deepEqual(fs.readdirSync(path.join(root, 'scripts')), ['deploy.sh']);
  });

  it('lists only repository files', () => {
    assert.ok(REPO_ONLY_FILES.includes('scripts/link-local.mjs'));
    for (const kept of ['.env.example', '.gitignore', 'package.json', 'tests', 'eslint.config.js']) {
      assert.equal(REPO_ONLY_FILES.includes(kept), false, kept);
    }
  });

  it('documents only scripts the app has', () => {
    const readme = projectReadme({
      name: 'x', db: 'sqlite', packageManager: 'yarn', ref: null, scripts: ['dev', 'unknown'],
    });
    assert.match(readme, /\| `yarn run dev` \|/);
    assert.doesNotMatch(readme, /unknown/);
    assert.match(readme, /blob\/master\/README\.md/);
  });
});
