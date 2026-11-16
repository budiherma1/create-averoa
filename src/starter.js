import fs from 'node:fs';
import path from 'node:path';
import { setEnvValue } from './scaffold.js';

/**
 * Starters are variants of the boilerplate kept in its `starters/` folder, so
 * every AveroaJS version carries starters that match it:
 *
 *   starters/<name>/starter.json   the manifest (below)
 *   starters/<name>/files/...      copied over the app, replacing files with the same path
 *
 * starter.json:
 *   {
 *     "description": "shown by the prompt and --help",
 *     "extends": "minimal",               // applied first (optional)
 *     "remove": ["app/Models/Teacher.js", "routes/v2"],
 *     "dependencies": { "name": "^1.0.0" },
 *     "devDependencies": {},
 *     "scripts": { "name": "command" },
 *     "env": { "KEY": "value" }           // set in .env.example (and so in .env)
 *   }
 *
 * The `starters/` folder itself never reaches the new app (REPO_ONLY_FILES).
 */
export const STARTERS_DIR = 'starters';
export const STARTER_NAME = /^[a-z][a-z0-9-]{0,49}$/;

const MANIFEST_KEYS = new Set(['description', 'extends', 'remove', 'dependencies', 'devDependencies', 'scripts', 'env']);
const MAX_EXTENDS = 10;

/** A relative path inside the app: no absolute paths, backslashes, `..` or empty segments. */
function safeRelative(value, where) {
  if (typeof value !== 'string' || value === '' || value.startsWith('/') || value.includes('\\')
    || /^[A-Za-z]:/.test(value) || value.split('/').some((part) => part === '' || part === '.' || part === '..')) {
    throw new Error(`${where}: "${value}" is not a relative path inside the app`);
  }
  return value;
}

function stringMap(value, where, keyPattern) {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${where} must be an object`);
  for (const [key, v] of Object.entries(value)) {
    if (typeof v !== 'string') throw new Error(`${where}.${key} must be a string`);
    if (keyPattern && !keyPattern.test(key)) throw new Error(`${where}: invalid name "${key}"`);
  }
  return value;
}

/** Reads and checks `starters/<name>/starter.json` of the boilerplate at `root`. */
export function readStarter(root, name) {
  if (!STARTER_NAME.test(name)) throw new Error(`Invalid starter name "${name}": use lower-case letters, digits and -.`);
  const file = path.join(root, STARTERS_DIR, name, 'starter.json');
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
  let manifest;
  try {
    manifest = JSON.parse(raw);
  } catch (err) {
    throw new Error(`starters/${name}/starter.json is not valid JSON: ${err.message}`);
  }
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error(`starters/${name}/starter.json must be an object`);
  }
  const where = `starters/${name}/starter.json`;
  for (const key of Object.keys(manifest)) {
    if (!MANIFEST_KEYS.has(key)) throw new Error(`${where}: unknown key "${key}"`);
  }
  if (manifest.extends !== undefined && (typeof manifest.extends !== 'string' || !STARTER_NAME.test(manifest.extends))) {
    throw new Error(`${where}: "extends" must be a starter name`);
  }
  if (manifest.remove !== undefined && !Array.isArray(manifest.remove)) throw new Error(`${where}: "remove" must be an array`);
  return {
    name,
    description: typeof manifest.description === 'string' ? manifest.description : '',
    extends: manifest.extends,
    remove: (manifest.remove ?? []).map((p) => safeRelative(p, `${where} remove`)),
    dependencies: stringMap(manifest.dependencies, `${where} dependencies`),
    devDependencies: stringMap(manifest.devDependencies, `${where} devDependencies`),
    scripts: stringMap(manifest.scripts, `${where} scripts`),
    env: stringMap(manifest.env, `${where} env`, /^[A-Z][A-Z0-9_]*$/),
  };
}

/** The starters of the boilerplate at `root`, sorted by name: [{ name, description }]. */
export function listStarters(root) {
  const dir = path.join(root, STARTERS_DIR);
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  return entries
    .filter((e) => e.isDirectory() && STARTER_NAME.test(e.name))
    .map((e) => readStarter(root, e.name))
    .filter(Boolean)
    .map(({ name, description }) => ({ name, description }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The starter and the ones it extends, base first. */
export function resolveStarter(root, name) {
  const chain = [];
  let current = name;
  while (current) {
    if (chain.some((s) => s.name === current)) {
      throw new Error(`starter "${name}" extends itself (${[...chain.map((s) => s.name), current].join(' -> ')})`);
    }
    if (chain.length >= MAX_EXTENDS) throw new Error(`starter "${name}": more than ${MAX_EXTENDS} levels of "extends"`);
    const starter = readStarter(root, current);
    if (!starter) {
      if (current === name) return null;
      throw new Error(`starter "${chain.at(-1).name}" extends "${current}", which does not exist`);
    }
    chain.push(starter);
    current = starter.extends;
  }
  return chain.reverse();
}

/** Every file below `dir`, as relative paths with `/`. */
function filesBelow(dir, prefix = '') {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...filesBelow(path.join(dir, entry.name), rel));
    else if (entry.isFile()) out.push(rel);
    else throw new Error(`${rel}: starters may only contain regular files`);
  }
  return out;
}

const sortKeys = (obj) => Object.fromEntries(Object.entries(obj).sort(([a], [b]) => a.localeCompare(b)));

/**
 * Applies a starter (and the ones it extends) to the boilerplate at `root`:
 * removes its `remove` paths, copies its `files/`, merges its package.json
 * fields and sets its `env` values in .env.example.
 *
 * @returns {{ chain: string[], removed: string[], written: string[], packages: string[] } | null}
 *   null when the boilerplate has no starter of that name
 */
export function applyStarter(root, name) {
  const chain = resolveStarter(root, name);
  if (!chain) return null;
  const removed = [];
  const written = [];
  const packages = [];
  const pkgFile = path.join(root, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
  const exampleFile = path.join(root, '.env.example');
  let example = fs.existsSync(exampleFile) ? fs.readFileSync(exampleFile, 'utf8') : '';

  for (const starter of chain) {
    for (const rel of starter.remove) {
      const target = path.join(root, rel);
      if (fs.existsSync(target)) {
        fs.rmSync(target, { recursive: true, force: true });
        removed.push(rel);
      }
    }
    const filesDir = path.join(root, STARTERS_DIR, starter.name, 'files');
    if (fs.existsSync(filesDir)) {
      for (const rel of filesBelow(filesDir)) {
        safeRelative(rel, `starters/${starter.name}/files`);
        const target = path.join(root, rel);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(path.join(filesDir, rel), target);
        written.push(rel);
      }
    }
    for (const field of ['dependencies', 'devDependencies']) {
      const entries = Object.entries(starter[field]);
      if (!entries.length) continue;
      pkg[field] = sortKeys({ ...pkg[field], ...starter[field] });
      packages.push(...entries.map(([n, v]) => `${n}@${v}`));
    }
    if (Object.keys(starter.scripts).length) pkg.scripts = { ...pkg.scripts, ...starter.scripts };
    for (const [key, value] of Object.entries(starter.env)) example = setEnvValue(example, key, value);
  }

  fs.writeFileSync(pkgFile, `${JSON.stringify(pkg, null, 2)}\n`);
  if (example) fs.writeFileSync(exampleFile, example);
  return {
    chain: chain.map((s) => s.name), removed, written: [...new Set(written)], packages,
  };
}
