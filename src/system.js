import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { PACKAGE_MANAGERS } from './args.js';

const isWindows = process.platform === 'win32';

/** Package manager that runs create-averoa ("pnpm/9.12.0 npm/? node/v22..." -> "pnpm"). */
export function detectPackageManager(userAgent) {
  const name = String(userAgent ?? '').split(' ')[0].split('/')[0];
  return PACKAGE_MANAGERS.includes(name) ? name : null;
}

/** Runs a command with inherited stdio; resolves to the exit code (127 when it cannot start). */
export function runInherit(command, args, { cwd, env }) {
  return new Promise((resolve) => {
    // npm, pnpm and yarn are .cmd shims on Windows, which need a shell (the arguments are fixed)
    const child = spawn(command, args, {
      cwd, env, stdio: 'inherit', shell: isWindows, windowsHide: true,
    });
    child.on('error', () => resolve(127));
    child.on('close', (code) => resolve(code ?? 1));
  });
}

export function installDependencies(pm, { cwd, env }) {
  return runInherit(pm, ['install'], { cwd, env });
}

function git(args, { cwd, env }) {
  return spawnSync('git', args, {
    cwd, env, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/**
 * `git init` plus an initial commit. Skipped (with a reason) when git is not
 * installed, the directory is already inside a work tree, or user.name /
 * user.email are not configured; a failed commit removes the new .git again.
 *
 * @returns {{ ok: boolean, reason?: string }}
 */
export function initGitRepository({ cwd, env }) {
  const version = git(['--version'], { cwd, env });
  if (version.error || version.status !== 0) return { ok: false, reason: 'git is not installed' };

  const inside = git(['rev-parse', '--is-inside-work-tree'], { cwd, env });
  if (inside.status === 0 && inside.stdout.trim() === 'true') {
    return { ok: false, reason: 'the directory is already inside a git repository' };
  }
  const userName = git(['config', 'user.name'], { cwd, env }).stdout?.trim();
  const userEmail = git(['config', 'user.email'], { cwd, env }).stdout?.trim();
  if (!userName || !userEmail) {
    return { ok: false, reason: 'git user.name / user.email are not configured' };
  }

  for (const args of [['init'], ['add', '-A'], ['commit', '-m', 'Initial commit from create-averoa']]) {
    const result = git(args, { cwd, env });
    if (result.status !== 0) {
      fs.rmSync(path.join(cwd, '.git'), { recursive: true, force: true });
      return { ok: false, reason: `git ${args[0]} failed: ${(result.stderr || result.stdout || '').trim()}` };
    }
  }
  return { ok: true };
}

function parseVersion(text) {
  const m = /^v?(\d+)(?:\.(\d+|x|\*))?(?:\.(\d+|x|\*))?$/.exec(text.trim());
  if (!m) return null;
  return m.slice(1).map((p) => (p === undefined || p === 'x' || p === '*' ? 0 : Number(p)));
}

function compare(a, b) {
  for (let i = 0; i < 3; i += 1) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

/**
 * Minimal check of a Node.js version against an `engines.node` range made of
 * `||` alternatives with `^`, `>=`, `>`, `<=`, `<` and exact comparators.
 * Returns null for ranges it does not understand.
 */
export function satisfiesRange(version, range) {
  const v = parseVersion(version);
  if (!v || typeof range !== 'string') return null;
  let understood = true;
  const result = range.split('||').some((set) => set.trim().split(/\s+/).filter(Boolean).every((comp) => {
    const m = /^(\^|>=|<=|>|<|=)?(.+)$/.exec(comp);
    const target = m && parseVersion(m[2]);
    if (!target) {
      understood = false;
      return false;
    }
    const c = compare(v, target);
    switch (m[1]) {
      case '^': return c >= 0 && (target[0] === 0 ? v[0] === 0 && v[1] === target[1] : v[0] === target[0]);
      case '>=': return c >= 0;
      case '>': return c > 0;
      case '<=': return c <= 0;
      case '<': return c < 0;
      default: return c === 0;
    }
  }));
  return understood ? result : null;
}
