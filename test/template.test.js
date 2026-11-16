import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { Readable } from 'node:stream';
import { describe, it } from 'node:test';
import {
  copyTemplateDir, extractTarball, FALLBACK_REF, findTemplateRoot, obtainTemplate, pickLatestTag,
  resolveLatestTag, tarballUrl, tarCommand,
} from '../src/template.js';
import { fixtureTarball, FIXTURE, tempDir } from './helpers.js';

const hasGit = spawnSync('git', ['--version']).status === 0;

/** fetch stand-in: answers from a map of URL -> Response factory, records the calls. */
function fakeFetch(routes) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url: String(url), init });
    const route = routes[String(url)];
    if (!route) return new Response('not found', { status: 404 });
    return route();
  };
  fn.calls = calls;
  return fn;
}

const tagsUrl = 'https://api.github.com/repos/budiherma1/averoajs/tags?per_page=100';

describe('pickLatestTag', () => {
  it('picks the highest stable version, not the first or the alphabetical last', () => {
    assert.equal(pickLatestTag(['v2.0.0', 'v10.0.0', 'v2.10.1', 'v9.9.9']), 'v10.0.0');
    assert.equal(pickLatestTag(['v2.1.0', 'v2.10.0', 'v2.9.0']), 'v2.10.0');
  });

  it('ignores pre-releases and other tags', () => {
    assert.equal(pickLatestTag(['v3.0.0-beta.1', 'latest', '3.0.0', 'v2.1.0']), 'v2.1.0');
    assert.equal(pickLatestTag(['nightly']), null);
    assert.equal(pickLatestTag([]), null);
  });
});

describe('resolveLatestTag', () => {
  it('reads the tags from the GitHub API', async () => {
    const fetch = fakeFetch({ [tagsUrl]: () => Response.json([{ name: 'v2.0.0' }, { name: 'v2.1.0' }]) });
    assert.equal(await resolveLatestTag({ fetch, env: {} }), 'v2.1.0');
    assert.equal(fetch.calls[0].init.headers['user-agent'], 'create-averoa');
    assert.equal(fetch.calls[0].init.headers.authorization, undefined);
  });

  it('sends GITHUB_TOKEN when set', async () => {
    const fetch = fakeFetch({ [tagsUrl]: () => Response.json([{ name: 'v1.0.0' }]) });
    await resolveLatestTag({ fetch, env: { GITHUB_TOKEN: 't0k' } });
    assert.equal(fetch.calls[0].init.headers.authorization, 'Bearer t0k');
  });

  it('explains rate limits and empty tag lists', async () => {
    await assert.rejects(
      resolveLatestTag({ fetch: fakeFetch({ [tagsUrl]: () => new Response('', { status: 403 }) }), env: {} }),
      /403 \(rate limited; set GITHUB_TOKEN\)/,
    );
    await assert.rejects(
      resolveLatestTag({ fetch: fakeFetch({ [tagsUrl]: () => Response.json([]) }), env: {} }),
      /no v\* tag/,
    );
    await assert.rejects(
      resolveLatestTag({ fetch: () => Promise.reject(new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } })), env: {} }),
      /could not reach the GitHub API: ENOTFOUND/,
    );
  });
});

describe('tarballUrl', () => {
  it('builds codeload URLs', () => {
    assert.equal(tarballUrl('v2.1.0'), 'https://codeload.github.com/budiherma1/averoajs/tar.gz/v2.1.0');
    assert.equal(tarballUrl('feat/x'), 'https://codeload.github.com/budiherma1/averoajs/tar.gz/feat/x');
  });
});

describe('tarCommand', () => {
  it('uses tar from PATH outside Windows', () => {
    assert.equal(tarCommand('linux', {}), 'tar');
    assert.equal(tarCommand('darwin', {}), 'tar');
  });
});

describe('extractTarball', () => {
  it('extracts a GitHub-style archive, without the pax header', async (t) => {
    const dest = tempDir(t);
    await extractTarball(fs.createReadStream(fixtureTarball(t)), dest);
    const root = findTemplateRoot(dest);
    assert.equal(path.basename(root), 'averoajs-2.1.0');
    assert.ok(fs.existsSync(path.join(root, '.env.example')));
    assert.ok(fs.existsSync(path.join(root, '.github', 'workflows', 'ci.yml')));
  });

  it('fails on data that is not a tarball', async (t) => {
    await assert.rejects(extractTarball(Readable.from([Buffer.from('<html>nope</html>')]), tempDir(t)), /tar could not extract/);
  });

  it('reports a missing tar command', async (t) => {
    await assert.rejects(
      extractTarball(Readable.from([Buffer.alloc(10)]), tempDir(t), { tar: 'tar-that-does-not-exist' }),
      /the "tar" command was not found/,
    );
  });

  it('reports errors of the input stream', async (t) => {
    const input = new Readable({ read() { this.destroy(new Error('connection reset')); } });
    await assert.rejects(extractTarball(input, tempDir(t)), /connection reset/);
  });
});

describe('findTemplateRoot', () => {
  it('accepts a folder with package.json or a single wrapper folder', (t) => {
    const dir = tempDir(t);
    fs.writeFileSync(path.join(dir, 'package.json'), '{}');
    assert.equal(findTemplateRoot(dir), dir);

    const wrapped = tempDir(t);
    fs.mkdirSync(path.join(wrapped, 'repo-abc'));
    fs.writeFileSync(path.join(wrapped, 'repo-abc', 'package.json'), '{}');
    fs.writeFileSync(path.join(wrapped, 'pax_global_header'), '');
    assert.equal(findTemplateRoot(wrapped), path.join(wrapped, 'repo-abc'));
  });

  it('rejects anything else', (t) => {
    const dir = tempDir(t);
    fs.mkdirSync(path.join(dir, 'a'));
    fs.mkdirSync(path.join(dir, 'b'));
    assert.throws(() => findTemplateRoot(dir), /no package\.json/);
  });
});

describe('copyTemplateDir', () => {
  it('skips .git, node_modules and .env', (t) => {
    const src = path.join(tempDir(t), 'src');
    fs.cpSync(FIXTURE, src, { recursive: true });
    fs.mkdirSync(path.join(src, 'node_modules', 'x'), { recursive: true });
    fs.writeFileSync(path.join(src, 'node_modules', 'x', 'index.js'), '');
    fs.writeFileSync(path.join(src, '.env'), 'TOKEN_SECRET=mine');
    fs.mkdirSync(path.join(src, '.git'));
    fs.writeFileSync(path.join(src, '.git', 'HEAD'), 'not a real repo');
    const dest = tempDir(t);
    copyTemplateDir(src, dest);
    for (const skipped of ['node_modules', '.env', '.git']) assert.equal(fs.existsSync(path.join(dest, skipped)), false, skipped);
    assert.ok(fs.existsSync(path.join(dest, 'package.json')));
    assert.ok(fs.existsSync(path.join(dest, '.env.example')));
  });

  it('copies only what git would commit from a work tree', { skip: !hasGit && 'git is not installed' }, (t) => {
    const src = path.join(tempDir(t), 'src');
    fs.cpSync(FIXTURE, src, { recursive: true });
    execFileSync('git', ['init', '-q'], { cwd: src });
    execFileSync('git', ['add', 'package.json'], { cwd: src });
    fs.writeFileSync(path.join(src, 'database', 'dev.sqlite'), 'ignored');
    fs.writeFileSync(path.join(src, '.env'), 'ignored');
    fs.writeFileSync(path.join(src, 'untracked.js'), 'kept');
    const dest = tempDir(t);
    copyTemplateDir(src, dest);
    assert.ok(fs.existsSync(path.join(dest, 'package.json')), 'tracked');
    assert.ok(fs.existsSync(path.join(dest, 'untracked.js')), 'untracked, not ignored');
    assert.ok(fs.existsSync(path.join(dest, 'storages', 'logs', '.gitkeep')));
    assert.equal(fs.existsSync(path.join(dest, 'database', 'dev.sqlite')), false, 'ignored');
    assert.equal(fs.existsSync(path.join(dest, '.env')), false, 'ignored');
    assert.equal(fs.existsSync(path.join(dest, '.git')), false);
  });
});

describe('obtainTemplate', () => {
  it('downloads the latest tag from GitHub', async (t) => {
    const tarball = fs.readFileSync(fixtureTarball(t, 'averoajs-2.2.0'));
    const fetch = fakeFetch({
      [tagsUrl]: () => Response.json([{ name: 'v2.1.0' }, { name: 'v2.2.0' }]),
      'https://codeload.github.com/budiherma1/averoajs/tar.gz/v2.2.0': () => new Response(tarball),
    });
    const dest = tempDir(t);
    const result = await obtainTemplate({ dest, fetch, env: {} });
    assert.equal(result.ref, 'v2.2.0');
    assert.equal(result.root, path.join(dest, 'averoajs-2.2.0'));
    assert.ok(fs.existsSync(path.join(result.root, 'package.json')));
  });

  it('downloads an explicit ref without asking the API', async (t) => {
    const tarball = fs.readFileSync(fixtureTarball(t));
    const fetch = fakeFetch({ 'https://codeload.github.com/budiherma1/averoajs/tar.gz/v2.0.0': () => new Response(tarball) });
    const result = await obtainTemplate({ ref: 'v2.0.0', dest: tempDir(t), fetch, env: {} });
    assert.equal(result.ref, 'v2.0.0');
    assert.equal(fetch.calls.length, 1);
  });

  it(`falls back to ${FALLBACK_REF} with a warning when the API fails`, async (t) => {
    const tarball = fs.readFileSync(fixtureTarball(t));
    const fetch = fakeFetch({
      [tagsUrl]: () => new Response('', { status: 500 }),
      [tarballUrl(FALLBACK_REF)]: () => new Response(tarball),
    });
    const warnings = [];
    const result = await obtainTemplate({ dest: tempDir(t), fetch, env: {}, warn: (m) => warnings.push(m) });
    assert.equal(result.ref, FALLBACK_REF);
    assert.match(warnings[0], /answered 500.*using v/);
  });

  it('explains an unknown ref', async (t) => {
    await assert.rejects(
      obtainTemplate({ ref: 'v0.0.1', dest: tempDir(t), fetch: fakeFetch({}), env: {} }),
      /tar\.gz\/v0\.0\.1 was not found \(404\)\. Check the --ref/,
    );
  });

  it('uses a local tarball, directory or http URL', async (t) => {
    const file = fixtureTarball(t);
    const fromFile = await obtainTemplate({ template: file, dest: tempDir(t) });
    assert.equal(fromFile.ref, null);
    assert.equal(fromFile.source, file);
    assert.ok(fs.existsSync(path.join(fromFile.root, 'package.json')));

    const fromDir = await obtainTemplate({ template: FIXTURE, dest: tempDir(t) });
    assert.ok(fs.existsSync(path.join(fromDir.root, 'scripts', 'link-local.mjs')));

    const server = http.createServer((req, res) => {
      if (req.url !== '/averoajs.tar.gz') {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, { 'content-type': 'application/gzip' });
      fs.createReadStream(file).pipe(res);
    });
    await new Promise((resolve) => { server.listen(0, '127.0.0.1', resolve); });
    t.after(() => server.close());
    const url = `http://127.0.0.1:${server.address().port}/averoajs.tar.gz`;
    const fromUrl = await obtainTemplate({ template: url, dest: tempDir(t) });
    assert.equal(fromUrl.source, url);
    assert.ok(fs.existsSync(path.join(fromUrl.root, '.env.example')));
  });

  it('rejects plain http to other hosts, unknown files and missing paths', async (t) => {
    await assert.rejects(obtainTemplate({ template: 'http://example.com/a.tgz', dest: tempDir(t) }), /must use https/);
    const zip = path.join(tempDir(t), 'a.zip');
    fs.writeFileSync(zip, '');
    await assert.rejects(obtainTemplate({ template: zip, dest: tempDir(t) }), /directory, a \.tar\.gz/);
    await assert.rejects(obtainTemplate({ template: '/does/not/exist', dest: tempDir(t) }), /does not exist/);
  });
});
