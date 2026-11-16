import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { tarCommand } from '../src/template.js';

export const FIXTURE = fileURLToPath(new URL('./fixtures/template', import.meta.url));

/** A temporary directory removed after the test. */
export function tempDir(t, prefix = 'create-averoa-test-') {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** Copy of the fixture template that a test may modify. */
export function fixtureCopy(t) {
  const dir = path.join(tempDir(t), 'template');
  fs.cpSync(FIXTURE, dir, { recursive: true });
  return dir;
}

/** Builds a GitHub-style archive (one top-level averoajs-<version>/ folder) of the fixture. */
export function fixtureTarball(t, top = 'averoajs-2.1.0') {
  const dir = tempDir(t);
  fs.cpSync(FIXTURE, path.join(dir, top), { recursive: true });
  execFileSync(tarCommand(), ['-czf', 'template.tar.gz', top], { cwd: dir });
  return path.join(dir, 'template.tar.gz');
}

/** Writable stream that keeps what was written (stdout / stderr stand-in). */
export function collector() {
  const chunks = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(String(chunk));
      cb();
    },
  });
  stream.isTTY = false;
  stream.text = () => chunks.join('');
  return stream;
}

/** Non-interactive io for run(): no TTY, captured output, no network. */
export function testIo(cwd, env = {}) {
  return {
    cwd,
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, ...env },
    stdin: { isTTY: false },
    stdout: collector(),
    stderr: collector(),
    fetch: () => Promise.reject(new Error('network access is disabled in tests')),
  };
}

export function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
