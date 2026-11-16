import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';

export const REPO = 'budiherma1/averoajs';
/** Used when the latest tag cannot be looked up (offline API, rate limit). */
export const FALLBACK_REF = 'v2.2.1';
const API_URL = 'https://api.github.com';
const CODELOAD_URL = 'https://codeload.github.com';
const DOWNLOAD_TIMEOUT = 120_000;
const API_TIMEOUT = 15_000;
const USER_AGENT = 'create-averoa';

/** Highest stable `vX.Y.Z` tag of a list of tag names, or null. */
export function pickLatestTag(names) {
  const versions = names
    .map((name) => ({ name, m: /^v(\d+)\.(\d+)\.(\d+)$/.exec(name) }))
    .filter((t) => t.m)
    .map((t) => ({ name: t.name, v: t.m.slice(1).map(Number) }));
  versions.sort((a, b) => b.v[0] - a.v[0] || b.v[1] - a.v[1] || b.v[2] - a.v[2]);
  return versions[0]?.name ?? null;
}

function apiHeaders(env) {
  const headers = {
    accept: 'application/vnd.github+json',
    'user-agent': USER_AGENT,
    'x-github-api-version': '2022-11-28',
  };
  const token = env.GITHUB_TOKEN || env.GH_TOKEN;
  if (token) headers.authorization = `Bearer ${token}`;
  return headers;
}

function describeFetchError(err) {
  const cause = err?.cause;
  if (err?.name === 'TimeoutError') return 'the request timed out';
  if (cause?.code) return `${cause.code}${cause.message ? ` (${cause.message})` : ''}`;
  return cause?.message || err?.message || String(err);
}

/** Looks up the latest `v*` tag of the boilerplate with the GitHub API. */
export async function resolveLatestTag({ fetch = globalThis.fetch, env = process.env } = {}) {
  const url = `${API_URL}/repos/${REPO}/tags?per_page=100`;
  let res;
  try {
    res = await fetch(url, { headers: apiHeaders(env), signal: AbortSignal.timeout(API_TIMEOUT) });
  } catch (err) {
    throw new Error(`could not reach the GitHub API: ${describeFetchError(err)}`);
  }
  if (!res.ok) {
    const limited = res.status === 403 || res.status === 429;
    throw new Error(`the GitHub API answered ${res.status}${limited ? ' (rate limited; set GITHUB_TOKEN)' : ''}`);
  }
  const tags = await res.json();
  const tag = pickLatestTag(Array.isArray(tags) ? tags.map((t) => t.name) : []);
  if (!tag) throw new Error(`no v* tag found in ${REPO}`);
  return tag;
}

export function tarballUrl(ref) {
  return `${CODELOAD_URL}/${REPO}/tar.gz/${ref.split('/').map(encodeURIComponent).join('/')}`;
}

/**
 * The system tar: bsdtar on macOS and Windows 10+, GNU tar or bsdtar on Linux.
 * On Windows the System32 copy is used explicitly, because a GNU tar from Git
 * for Windows earlier in PATH reads "C:" in a path as a remote host.
 */
export function tarCommand(platform = process.platform, env = process.env) {
  if (platform === 'win32') {
    const systemTar = path.join(env.SystemRoot || env.windir || 'C:\\Windows', 'System32', 'tar.exe');
    if (fs.existsSync(systemTar)) return systemTar;
  }
  return 'tar';
}

/**
 * Extracts a gzipped tarball read from `input` into `dest`. The archive is fed
 * to tar on stdin, so no archive path is ever passed on the command line.
 */
export function extractTarball(input, dest, { tar = tarCommand() } = {}) {
  return new Promise((resolve, reject) => {
    let inputError;
    let settled = false;
    const done = (err) => {
      if (settled) return;
      settled = true;
      if (err) reject(err); else resolve();
    };

    const child = spawn(tar, ['-xzf', '-'], { cwd: dest, stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true });
    let stderr = '';
    child.stderr.setEncoding('utf8').on('data', (d) => { stderr += d; });
    child.on('error', (err) => {
      input.destroy?.();
      done(err.code === 'ENOENT'
        ? new Error(`the "tar" command was not found (${tar}). Install tar, or download the boilerplate yourself and pass --template <directory>.`)
        : err);
    });
    child.on('close', (code) => {
      if (inputError) done(inputError);
      else if (code === 0) done();
      else done(new Error(`tar could not extract the archive (exit code ${code})${stderr.trim() ? `: ${stderr.trim()}` : ''}`));
    });
    // EPIPE when tar stops reading early; the exit code reports the real problem
    child.stdin.on('error', () => {});
    input.on('error', (err) => {
      inputError = err;
      child.stdin.destroy();
    });
    input.pipe(child.stdin);
  });
}

function isLocalHttp(url) {
  return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
}

/** Downloads a .tar.gz from `url` and extracts it into `dest`. */
export async function downloadTarball(url, dest, { fetch = globalThis.fetch, timeout = DOWNLOAD_TIMEOUT } = {}) {
  let res;
  try {
    res = await fetch(url, { headers: { 'user-agent': USER_AGENT }, redirect: 'follow', signal: AbortSignal.timeout(timeout) });
  } catch (err) {
    throw new Error(`could not download ${url}: ${describeFetchError(err)}`);
  }
  if (res.status === 404) throw new Error(`${url} was not found (404). Check the --ref or --template value.`);
  if (!res.ok || !res.body) throw new Error(`could not download ${url}: HTTP ${res.status}`);
  const body = Readable.fromWeb(res.body);
  try {
    await extractTarball(body, dest);
  } catch (err) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      throw new Error(`could not download ${url}: the request timed out`);
    }
    throw err;
  }
}

// never copied from a local template directory
const SKIP_NAMES = new Set(['.git', 'node_modules', '.DS_Store']);
const SKIP_ROOT = new Set(['.env']);

function gitFileList(dir) {
  if (!fs.existsSync(path.join(dir, '.git'))) return null;
  const out = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
    cwd: dir, encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024,
  });
  if (out.status !== 0) return null;
  return out.stdout.split('\0').filter(Boolean);
}

/**
 * Copies a local template directory. In a git work tree, only tracked and
 * untracked-but-not-ignored files are copied (what a commit would contain);
 * otherwise everything except .git, node_modules and the root .env.
 */
export function copyTemplateDir(src, dest) {
  const files = gitFileList(src);
  if (files) {
    for (const rel of files) {
      if (rel.split('/').some((p) => SKIP_NAMES.has(p)) || SKIP_ROOT.has(rel)) continue;
      const from = path.join(src, rel);
      const stat = fs.lstatSync(from, { throwIfNoEntry: false });
      if (!stat || stat.isDirectory()) continue; // deleted, or a submodule
      fs.mkdirSync(path.dirname(path.join(dest, rel)), { recursive: true });
      fs.cpSync(from, path.join(dest, rel), { verbatimSymlinks: true });
    }
    return;
  }
  fs.cpSync(src, dest, {
    recursive: true,
    verbatimSymlinks: true,
    filter: (file) => {
      const rel = path.relative(src, file);
      if (!rel) return true;
      if (SKIP_ROOT.has(rel)) return false;
      return !rel.split(path.sep).some((p) => SKIP_NAMES.has(p));
    },
  });
}

/**
 * The folder holding the boilerplate's package.json: the extraction folder
 * itself, or its single top-level folder (GitHub archives use averoajs-<ref>/).
 */
export function findTemplateRoot(dir) {
  if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
  const entries = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.name !== 'pax_global_header');
  if (entries.length === 1 && entries[0].isDirectory()) {
    const inner = path.join(dir, entries[0].name);
    if (fs.existsSync(path.join(inner, 'package.json'))) return inner;
  }
  throw new Error('the template has no package.json at its root');
}

/**
 * Puts the boilerplate into `dest` (an empty directory) and returns its root.
 *
 * @param {{ template?: string, ref?: string, dest: string, cwd?: string, fetch?: Function,
 *   env?: object, warn?: (msg: string) => void }} options
 * @returns {Promise<{ root: string, ref: string | null, source: string }>}
 */
export async function obtainTemplate({
  template, ref, dest, cwd = process.cwd(), fetch = globalThis.fetch, env = process.env, warn = () => {},
}) {
  if (template) {
    if (/^https?:\/\//i.test(template)) {
      const url = new URL(template);
      if (url.protocol !== 'https:' && !isLocalHttp(url)) {
        throw new Error('--template URLs must use https (plain http is only allowed for localhost)');
      }
      await downloadTarball(url.href, dest, { fetch });
      return { root: findTemplateRoot(dest), ref: null, source: url.href };
    }
    const file = path.resolve(cwd, template);
    const stat = fs.statSync(file, { throwIfNoEntry: false });
    if (!stat) throw new Error(`--template ${template} does not exist`);
    if (stat.isDirectory()) {
      copyTemplateDir(file, dest);
    } else if (/\.(tar\.gz|tgz)$/i.test(file)) {
      await extractTarball(fs.createReadStream(file), dest);
    } else {
      throw new Error('--template must be a directory, a .tar.gz / .tgz file or an https URL');
    }
    return { root: findTemplateRoot(dest), ref: null, source: file };
  }

  let resolved = ref;
  if (!resolved) {
    try {
      resolved = await resolveLatestTag({ fetch, env });
    } catch (err) {
      warn(`Could not look up the latest AveroaJS version (${err.message}); using ${FALLBACK_REF}.`);
      resolved = FALLBACK_REF;
    }
  }
  const url = tarballUrl(resolved);
  await downloadTarball(url, dest, { fetch });
  return { root: findTemplateRoot(dest), ref: resolved, source: url };
}
