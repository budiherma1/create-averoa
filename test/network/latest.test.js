// Opt-in: downloads the real boilerplate from GitHub. Run with `npm run test:network`.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { run } from '../../src/cli.js';
import { resolveLatestTag } from '../../src/template.js';
import { readJson, tempDir, testIo } from '../helpers.js';

describe('GitHub (network)', { timeout: 180_000 }, () => {
  it('finds the latest v* tag', async () => {
    assert.match(await resolveLatestTag(), /^v\d+\.\d+\.\d+$/);
  });

  it('creates an application from the latest tag', async (t) => {
    const cwd = tempDir(t);
    const tag = await resolveLatestTag();
    const io = { ...testIo(cwd, { GITHUB_TOKEN: process.env.GITHUB_TOKEN }), fetch: globalThis.fetch };
    const code = await run(['net-app', '--no-install', '--no-git'], io);
    assert.equal(code, 0, io.stderr.text());
    assert.match(io.stdout.text(), new RegExp(`Template: averoajs ${tag.replace(/\./g, '\\.')}`));

    const app = path.join(cwd, 'net-app');
    const pkg = readJson(path.join(app, 'package.json'));
    assert.equal(pkg.name, 'net-app');
    assert.equal(pkg.version, '0.1.0');
    assert.equal(pkg.scripts['link:local'], undefined);
    assert.ok(pkg.dependencies['better-sqlite3']);
    assert.ok(pkg.dependencies['@averoa/core']);
    for (const file of ['server.js', 'averoa.js', 'routes/api.js', 'database/migrations', '.env.example', '.gitignore']) {
      assert.ok(fs.existsSync(path.join(app, file)), file);
    }
    assert.equal(fs.existsSync(path.join(app, 'scripts', 'link-local.mjs')), false);
    assert.equal(fs.existsSync(path.join(app, '.git')), false);
    const env = fs.readFileSync(path.join(app, '.env'), 'utf8');
    assert.match(env, /^TOKEN_SECRET=[0-9a-f]{128}$/m);
    assert.match(env, /^DB_CLIENT=better-sqlite3$/m);
  });
});
