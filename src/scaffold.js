import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { databaseName } from './name.js';

/**
 * Files of the averoajs repository that do not belong in a new application:
 * - scripts/link-local.mjs: installs local checkouts of the framework packages
 *   (framework development only), together with the `link:local` npm script
 * - CHANGELOG.md: the boilerplate's release history, not the new app's
 * - LICENSE: the boilerplate's MIT notice naming its author; the new app is
 *   the user's own project (package.json gets "private": true instead)
 * - .github/, CONTRIBUTING.md, CODE_OF_CONDUCT.md, SECURITY.md, FUNDING.yml:
 *   repository CI and community files
 * README.md is replaced by a short project README that links to the full
 * AveroaJS documentation for the version used.
 */
export const REPO_ONLY_FILES = [
  'scripts/link-local.mjs',
  'CHANGELOG.md',
  'LICENSE',
  '.github',
  'CONTRIBUTING.md',
  'CODE_OF_CONDUCT.md',
  'SECURITY.md',
  'FUNDING.yml',
];
export const REPO_ONLY_SCRIPTS = ['link:local'];
// package.json fields describing the boilerplate repository, not the new app
const REPO_ONLY_FIELDS = ['description', 'repository', 'bugs', 'homepage', 'author', 'contributors', 'license', 'funding', 'keywords'];

const LOCKFILES = {
  npm: 'package-lock.json',
  pnpm: 'pnpm-lock.yaml',
  yarn: 'yarn.lock',
  bun: 'bun.lock',
};
const OTHER_LOCKFILES = ['npm-shrinkwrap.json', 'bun.lockb'];

const DRIVERS = {
  sqlite: { name: 'better-sqlite3', version: '^12.4.1' },
  mysql: { name: 'mysql2', version: '^3.15.0' },
  postgres: { name: 'pg', version: '^8.23.1' },
};

export const DB_LABELS = { sqlite: 'SQLite', mysql: 'MySQL', postgres: 'PostgreSQL' };

/** .env values written for each --db preset. */
export function dbEnv(db, packageName) {
  if (db === 'sqlite') return { DB_CLIENT: 'better-sqlite3', DB_NAME: 'database/dev.sqlite' };
  if (db === 'mysql') return { DB_CLIENT: 'mysql2', DB_HOST: '127.0.0.1', DB_PORT: '3306', DB_NAME: databaseName(packageName) };
  if (db === 'postgres') return { DB_CLIENT: 'pg', DB_HOST: '127.0.0.1', DB_PORT: '5432', DB_NAME: databaseName(packageName) };
  throw new Error(`unknown database preset "${db}"`);
}

/** Sets `KEY=value` in dotenv text: replaces the first uncommented KEY line, or appends one. */
export function setEnvValue(text, key, value) {
  const line = new RegExp(`^${key}=.*$`, 'm');
  if (line.test(text)) return text.replace(line, () => `${key}=${value}`);
  return `${text}${text === '' || text.endsWith('\n') ? '' : '\n'}${key}=${value}\n`;
}

export function generateSecret() {
  return randomBytes(64).toString('hex');
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, data) {
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

/**
 * The database driver is a runtime dependency of the app. The boilerplate has
 * better-sqlite3 only as a devDependency (for its tests), which breaks
 * `npm ci --omit=dev` deployments; the selected driver is moved (or added) to
 * `dependencies`.
 */
function ensureDriver(pkg, db) {
  const { name, version } = DRIVERS[db];
  pkg.dependencies ??= {};
  if (pkg.dependencies[name]) return null;
  const spec = pkg.devDependencies?.[name] ?? version;
  if (pkg.devDependencies?.[name]) delete pkg.devDependencies[name];
  pkg.dependencies[name] = spec;
  pkg.dependencies = Object.fromEntries(Object.entries(pkg.dependencies).sort(([a], [b]) => a.localeCompare(b)));
  return `${name}@${spec}`;
}

function updatePackageJson(root, { name, db }) {
  const file = path.join(root, 'package.json');
  const pkg = readJson(file);
  for (const field of REPO_ONLY_FIELDS) delete pkg[field];
  const removedScripts = [];
  for (const script of REPO_ONLY_SCRIPTS) {
    if (pkg.scripts && script in pkg.scripts) {
      delete pkg.scripts[script];
      removedScripts.push(script);
    }
  }
  const driver = ensureDriver(pkg, db);
  delete pkg.name;
  delete pkg.version;
  delete pkg.private;
  writeJson(file, { name, version: '0.1.0', private: true, ...pkg });
  return { removedScripts, driver, scripts: Object.keys(pkg.scripts ?? {}) };
}

function updateLockfiles(root, { name, packageManager }) {
  const removed = [];
  for (const [pm, lockfile] of Object.entries(LOCKFILES)) {
    const file = path.join(root, lockfile);
    if (!fs.existsSync(file)) continue;
    if (pm !== packageManager) {
      fs.rmSync(file);
      removed.push(lockfile);
    } else if (pm === 'npm') {
      const lock = readJson(file);
      lock.name = name;
      lock.version = '0.1.0';
      if (lock.packages?.['']) {
        lock.packages[''].name = name;
        lock.packages[''].version = '0.1.0';
        delete lock.packages[''].license;
      }
      writeJson(file, lock);
    }
  }
  for (const lockfile of OTHER_LOCKFILES) {
    const file = path.join(root, lockfile);
    if (fs.existsSync(file)) {
      fs.rmSync(file);
      removed.push(lockfile);
    }
  }
  return removed;
}

function removeRepoFiles(root) {
  const removed = [];
  for (const rel of REPO_ONLY_FILES) {
    const file = path.join(root, rel);
    if (fs.existsSync(file)) {
      fs.rmSync(file, { recursive: true, force: true });
      removed.push(rel);
    }
  }
  const scripts = path.join(root, 'scripts');
  if (fs.existsSync(scripts) && fs.readdirSync(scripts).length === 0) fs.rmdirSync(scripts);
  return removed;
}

function writeEnv(root, { name, db, secret }) {
  const example = path.join(root, '.env.example');
  let text = fs.existsSync(example) ? fs.readFileSync(example, 'utf8') : '';
  const values = {
    TOKEN_SECRET: secret(),
    SESSION_SECRET: secret(),
    ...dbEnv(db, name),
  };
  for (const [key, value] of Object.entries(values)) text = setEnvValue(text, key, value);
  // the file holds secrets: owner read/write only (ignored on Windows)
  fs.writeFileSync(path.join(root, '.env'), text, { mode: 0o600 });
  return { text, keys: Object.keys(values) };
}

const SCRIPT_DOCS = {
  dev: 'Start the development server with nodemon',
  start: 'Start the server',
  test: 'Run the tests (node:test, in-memory SQLite)',
  lint: 'Lint with ESLint',
  'lint:fix': 'Lint and apply automatic fixes',
  'migrate:up': 'Run all pending migrations',
  'migrate:down': 'Roll back the last batch of migrations',
  'migrate:list': 'List completed and pending migrations',
  'migrate:make': 'Create a migration: `migrate:make <name>`',
  'seed:run': 'Run every seed file (replaces the seeded rows)',
  'seed:make': 'Create a seed file: `seed:make <name>`',
  'generate:token': 'Print a new random secret for TOKEN_SECRET / SESSION_SECRET',
  'worker:mail': 'Start the mail queue worker (needs RabbitMQ)',
};

export function runCommand(pm, script) {
  return `${pm} run ${script}`;
}

export function projectReadme({ name, db, packageManager: pm, ref, scripts }) {
  const docsRef = ref ?? 'master';
  const docs = `https://github.com/budiherma1/averoajs/blob/${docsRef}/README.md`;
  const version = ref ? ` ${ref}` : '';
  const dbNote = db === 'sqlite'
    ? 'The database is the SQLite file `database/dev.sqlite` (`DB_CLIENT=better-sqlite3` in `.env`), so no database server is needed.'
    : `The database is ${DB_LABELS[db]} (\`DB_CLIENT=${dbEnv(db, name).DB_CLIENT}\` in \`.env\`). Create the database \`${dbEnv(db, name).DB_NAME}\` and fill in \`DB_USER\` and \`DB_PASS\` in \`.env\` before running the migrations; Knex does not create the database itself.`;
  const rows = scripts
    .filter((s) => SCRIPT_DOCS[s])
    .map((s) => `| \`${runCommand(pm, s)}\` | ${SCRIPT_DOCS[s]} |`)
    .join('\n');

  return `# ${name}

An [AveroaJS](https://github.com/budiherma1/averoajs) application: Express 5, Knex, Objection and Edge with a
Laravel-style structure. Created with [create-averoa](https://github.com/budiherma1/create-averoa) from
AveroaJS${version}.

## Getting started

${dbNote}

\`\`\`bash
${runCommand(pm, 'migrate:up')}   # create the tables
${runCommand(pm, 'seed:run')}     # load the demo data
${runCommand(pm, 'dev')}          # start the development server
\`\`\`

Open <http://localhost:8888>, or call the API:

\`\`\`bash
curl http://localhost:8888/api

curl -X POST http://localhost:8888/api/auth/login \\
  -H 'content-type: application/json' \\
  -d '{"email":"demo@averoa.test","password":"password"}'
\`\`\`

The seeders create the demo user \`demo@averoa.test\`; every seeded user has the password \`password\`.

## Scripts

| Command | Description |
| --- | --- |
${rows}

## Configuration

Settings are read from \`.env\`, which was created from \`.env.example\` with freshly generated \`TOKEN_SECRET\` and
\`SESSION_SECRET\` values. \`.env\` is git-ignored: never commit it, and use different secrets in every environment.
Add new settings to \`.env.example\` so that the rest of the team knows about them.

## Documentation

The AveroaJS guide covers routing, controllers, models, CRUD routes and query filters, authentication, views, mail
and queues, uploads, migrations, the \`node averoa make:*\` generators and the production checklist:
<${docs}>.
`;
}

/**
 * Turns an extracted boilerplate (`root`) into a new application.
 *
 * @param {string} root
 * @param {{ name: string, db: string, packageManager: string, ref?: string | null, secret?: () => string }} options
 */
export function postProcess(root, {
  name, db, packageManager = 'npm', ref = null, secret = generateSecret,
}) {
  if (!DRIVERS[db]) throw new Error(`unknown database preset "${db}"`);
  const { removedScripts, driver, scripts } = updatePackageJson(root, { name, db });
  const removedLockfiles = updateLockfiles(root, { name, packageManager });
  const removedFiles = removeRepoFiles(root);
  const env = writeEnv(root, { name, db, secret });
  fs.writeFileSync(path.join(root, 'README.md'), projectReadme({
    name, db, packageManager, ref, scripts,
  }));
  return {
    removedFiles, removedScripts, removedLockfiles, driver, envKeys: env.keys,
  };
}
