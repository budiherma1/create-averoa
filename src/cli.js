import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline/promises';
import { parseArgs, UsageError, USAGE } from './args.js';
import { toValidPackageName, validatePackageName } from './name.js';
import {
  DB_LABELS, dbEnv, postProcess, runCommand,
} from './scaffold.js';
import {
  detectPackageManager, initGitRepository, installDependencies, satisfiesRange,
} from './system.js';
import { obtainTemplate } from './template.js';
import { applyStarter, listStarters } from './starter.js';

const { version: VERSION } = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const DEFAULT_DIR = 'averoa-app';
// entries that still count as an empty directory
const IGNORABLE = new Set(['.git', '.DS_Store', 'Thumbs.db']);

export class Cancelled extends Error {}

function colors(enabled) {
  const wrap = (open, close) => (s) => (enabled ? `\u001b[${open}m${s}\u001b[${close}m` : String(s));
  return {
    bold: wrap(1, 22), dim: wrap(2, 22), red: wrap(31, 39), green: wrap(32, 39), yellow: wrap(33, 39), cyan: wrap(36, 39),
  };
}

export function isEmptyDir(dir) {
  return fs.readdirSync(dir).every((entry) => IGNORABLE.has(entry));
}

function createPrompter({ stdin, stdout }) {
  const rl = readline.createInterface({ input: stdin, output: stdout, terminal: true });
  const controller = new AbortController();
  let closed = false;
  rl.on('SIGINT', () => controller.abort());
  rl.on('close', () => controller.abort());

  async function ask(question) {
    try {
      return (await rl.question(question, { signal: controller.signal })).trim();
    } catch (err) {
      if (err.name === 'AbortError') throw new Cancelled('Cancelled.');
      throw err;
    }
  }

  return {
    async text(label, fallback, validate) {
      for (;;) {
        const answer = (await ask(`${label} (${fallback}): `)) || fallback;
        const problem = validate?.(answer);
        if (!problem) return answer;
        stdout.write(`  ${problem}\n`);
      }
    },
    async confirm(label, fallback) {
      for (;;) {
        const answer = (await ask(`${label} ${fallback ? '(Y/n)' : '(y/N)'} `)).toLowerCase();
        if (!answer) return fallback;
        if (answer === 'y' || answer === 'yes') return true;
        if (answer === 'n' || answer === 'no') return false;
      }
    },
    async select(label, choices) {
      stdout.write(`${label}:\n`);
      choices.forEach((c, i) => stdout.write(`  ${i + 1}) ${c.label}\n`));
      for (;;) {
        const answer = (await ask(`Choose 1-${choices.length} (1): `)).toLowerCase();
        if (!answer) return choices[0].value;
        const byIndex = choices[Number(answer) - 1];
        if (byIndex) return byIndex.value;
        const byValue = choices.find((c) => c.value === answer);
        if (byValue) return byValue.value;
      }
    },
    close() {
      if (!closed) {
        closed = true;
        rl.close();
      }
    },
  };
}

function shellPath(p) {
  return /[\s'"$&|;<>()`\\]/.test(p) ? `"${p.replace(/(["\\$`])/g, '\\$1')}"` : p;
}

function readEnvValue(file, key) {
  try {
    const m = new RegExp(`^${key}=(.*)$`, 'm').exec(fs.readFileSync(file, 'utf8'));
    return m?.[1].trim() || null;
  } catch {
    return null;
  }
}

async function create(options, ctx) {
  const {
    env, cwd, fetch, prompt, log, warn, c,
  } = ctx;

  const template = options.template ?? (options.ref ? undefined : env.CREATE_AVEROA_TEMPLATE || undefined);

  const dir = options.dir
    ?? (prompt ? await prompt.text('Project directory', DEFAULT_DIR, (v) => (v.trim() ? null : 'Enter a directory name.')) : DEFAULT_DIR);
  const target = path.resolve(cwd, dir);
  const display = path.relative(cwd, target) || '.';

  let { name } = options;
  if (name) {
    const check = validatePackageName(name);
    if (!check.valid) throw new UsageError(`Invalid --name "${name}": ${check.problems.join('; ')}.`);
  } else {
    const base = path.basename(target);
    if (validatePackageName(base).valid) {
      name = base;
    } else {
      const suggestion = toValidPackageName(base);
      if (prompt) {
        name = await prompt.text('Package name', suggestion, (v) => {
          const check = validatePackageName(v);
          return check.valid ? null : `Invalid package name: ${check.problems.join('; ')}.`;
        });
      } else {
        name = suggestion;
        log(`"${base}" is not a valid npm package name; using "${name}" (change it with --name).`);
      }
    }
  }

  const stat = fs.statSync(target, { throwIfNoEntry: false });
  if (stat && !stat.isDirectory()) throw new Error(`${display} exists and is not a directory.`);
  if (stat && !isEmptyDir(target) && !options.force) {
    const question = `${display} is not empty. Write into it anyway? Files with the same names are overwritten.`;
    if (!prompt) {
      throw new Error(`${display} is not empty. Choose another directory, or pass --force to write into it (files with the same names are overwritten).`);
    }
    if (!(await prompt.confirm(question, false))) throw new Cancelled('Cancelled.');
  }

  const db = options.db ?? (prompt
    ? await prompt.select('Database', [
      { value: 'sqlite', label: 'SQLite (no database server needed)' },
      { value: 'mysql', label: 'MySQL / MariaDB' },
      { value: 'postgres', label: 'PostgreSQL' },
    ])
    : 'sqlite');
  const pm = options.pm ?? detectPackageManager(env.npm_config_user_agent) ?? 'npm';
  const install = options.install ?? (prompt ? await prompt.confirm(`Install dependencies with ${pm}?`, true) : true);
  const gitInit = options.git ?? (prompt ? await prompt.confirm('Initialise a git repository?', true) : true);

  log(`\nCreating ${c.bold(name)} in ${c.cyan(target)}`);

  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'create-averoa-'));
  let ref;
  try {
    const obtained = await obtainTemplate({
      template, ref: options.ref, dest: staging, cwd, fetch, env, warn,
    });
    ref = obtained.ref;
    log(`  Template: ${ref ? `averoajs ${ref}` : obtained.source}`);

    const starters = listStarters(obtained.root);
    let { starter } = options;
    if (starter === undefined && prompt && starters.length > 0) {
      const choice = await prompt.select('Starter', [
        { value: '', label: 'Full boilerplate (with the example models, routes and views)' },
        ...starters.map((s) => ({ value: s.name, label: `${s.name}${s.description ? ` (${s.description})` : ''}` })),
      ]);
      starter = choice || undefined;
    }
    prompt?.close();
    if (starter) {
      const applied = applyStarter(obtained.root, starter);
      if (!applied) {
        const available = starters.map((s) => s.name).join(', ');
        throw new UsageError(available
          ? `Unknown starter "${starter}". This AveroaJS version has: ${available}.`
          : `This AveroaJS version${ref ? ` (${ref})` : ''} has no starters. Use a newer --ref, or leave out --starter.`);
      }
      log(`  Starter: ${applied.chain.join(' + ')} (${applied.removed.length} removed, ${applied.written.length} added or replaced)`);
      if (applied.packages.length) log(`  Added ${applied.packages.join(', ')} to package.json`);
    }

    const result = postProcess(obtained.root, {
      name, db, packageManager: pm, ref, starter: starter ?? null,
    });

    fs.mkdirSync(target, { recursive: true });
    const envFile = path.join(target, '.env');
    const keepEnv = fs.existsSync(envFile);
    fs.cpSync(obtained.root, target, {
      recursive: true,
      verbatimSymlinks: true,
      filter: (src) => !(keepEnv && src === path.join(obtained.root, '.env')),
    });
    if (keepEnv) {
      warn(`${path.join(display, '.env')} already exists and was kept; it did not get new secrets or database settings.`);
    } else {
      if (process.platform !== 'win32') fs.chmodSync(envFile, 0o600);
      log(`  Created .env with new TOKEN_SECRET and SESSION_SECRET, database: ${DB_LABELS[db]}`);
    }
    if (result.driver) log(`  Added ${result.driver} to dependencies`);
    const removed = [...result.removedFiles, ...result.removedLockfiles, ...result.removedScripts.map((s) => `npm script ${s}`)];
    if (removed.length) log(`  Removed repository-only files: ${removed.join(', ')}`);
  } finally {
    prompt?.close();
    fs.rmSync(staging, { recursive: true, force: true });
  }

  let installed = false;
  let installFailed = false;
  if (install) {
    log(`\nInstalling dependencies with ${pm}...\n`);
    const code = await installDependencies(pm, { cwd: target, env });
    installed = code === 0;
    installFailed = !installed;
    if (installFailed) warn(`${pm} install failed (exit code ${code}). Run it yourself in ${display}.`);
  }

  if (gitInit) {
    const result = initGitRepository({ cwd: target, env });
    if (result.ok) log('\nCreated a git repository with an initial commit.');
    else log(`\nSkipped git: ${result.reason}.`);
  }

  const pkg = JSON.parse(fs.readFileSync(path.join(target, 'package.json'), 'utf8'));
  if (satisfiesRange(process.versions.node, pkg.engines?.node) === false) {
    warn(`AveroaJS needs Node.js ${pkg.engines.node}; this is ${process.versions.node}. Upgrade Node.js before running the app.`);
  }

  const port = readEnvValue(path.join(target, '.env'), 'APP_PORT') || '8888';
  const steps = [];
  if (display !== '.') steps.push(`cd ${shellPath(display)}`);
  if (!installed) steps.push(`${pm} install`);
  if (db !== 'sqlite') {
    steps.push(`# create the database "${dbEnv(db, name).DB_NAME}" and set DB_USER / DB_PASS in .env`);
  }
  steps.push(runCommand(pm, 'migrate:up'), runCommand(pm, 'seed:run'), runCommand(pm, 'dev'));

  log(`\n${c.green('Done.')} Next steps:\n`);
  for (const step of steps) log(`  ${step.startsWith('#') ? c.dim(step) : step}`);
  log(`\nThen open http://localhost:${port} or call http://localhost:${port}/api`);
  log('Demo login: demo@averoa.test / password (POST /api/auth/login)');
  log(`Documentation: https://github.com/budiherma1/averoajs/blob/${ref ?? 'master'}/README.md`);

  return installFailed ? 1 : 0;
}

/**
 * Runs create-averoa and resolves to the process exit code.
 *
 * @param {string[]} argv
 * @param {{ env?: object, cwd?: string, stdin?: object, stdout?: object, stderr?: object, fetch?: Function }} [io]
 */
export async function run(argv, io = {}) {
  const {
    env = process.env,
    cwd = process.cwd(),
    stdin = process.stdin,
    stdout = process.stdout,
    stderr = process.stderr,
    fetch = globalThis.fetch,
  } = io;
  const c = colors(Boolean(stdout.isTTY) && !env.NO_COLOR);
  const log = (msg = '') => stdout.write(`${msg}\n`);
  const warn = (msg) => stderr.write(`${c.yellow('warning')} ${msg}\n`);

  let options;
  try {
    options = parseArgs(argv);
  } catch (err) {
    if (!(err instanceof UsageError)) throw err;
    stderr.write(`${c.red('error')} ${err.message}\nRun "create-averoa --help" for the options.\n`);
    return 1;
  }
  if (options.help) {
    log(USAGE);
    return 0;
  }
  if (options.version) {
    log(VERSION);
    return 0;
  }

  const interactive = !options.yes && Boolean(stdin.isTTY && stdout.isTTY);
  const prompt = interactive ? createPrompter({ stdin, stdout }) : null;
  try {
    return await create(options, {
      env, cwd, fetch, prompt, log, warn, c,
    });
  } catch (err) {
    if (err instanceof Cancelled) {
      stderr.write('\nCancelled. Nothing was written.\n');
      return 130;
    }
    stderr.write(`${c.red('error')} ${err.message}\n`);
    return 1;
  } finally {
    prompt?.close();
  }
}
