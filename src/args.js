/**
 * Command line parsing. Hand written instead of util.parseArgs because
 * `--no-<flag>` negation (allowNegative) needs Node.js 20.16 / 22.4.
 */

export class UsageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UsageError';
  }
}

/** Database presets and the names accepted for each by --db. */
export const DATABASES = ['sqlite', 'mysql', 'postgres'];
const DB_ALIASES = {
  sqlite: 'sqlite',
  sqlite3: 'sqlite',
  'better-sqlite3': 'sqlite',
  mysql: 'mysql',
  mysql2: 'mysql',
  mariadb: 'mysql',
  postgres: 'postgres',
  postgresql: 'postgres',
  pg: 'postgres',
};

export const PACKAGE_MANAGERS = ['npm', 'pnpm', 'yarn', 'bun'];

// tag, branch or commit: letters, digits, `.`, `_`, `-` and `/` (no `..`)
const REF_PATTERN = /^[\w.\-/]+$/;

const VALUE_OPTIONS = {
  '--db': 'db',
  '--ref': 'ref',
  '--template': 'template',
  '--name': 'name',
  '--pm': 'pm',
};

const FLAG_OPTIONS = {
  '--install': ['install', true],
  '--no-install': ['install', false],
  '--git': ['git', true],
  '--no-git': ['git', false],
  '--force': ['force', true],
  '-f': ['force', true],
  '--yes': ['yes', true],
  '-y': ['yes', true],
  '--help': ['help', true],
  '-h': ['help', true],
  '--version': ['version', true],
  '-v': ['version', true],
};

export function normalizeDb(value) {
  const db = DB_ALIASES[String(value).toLowerCase()];
  if (!db) throw new UsageError(`Unknown --db "${value}". Use one of: ${DATABASES.join(', ')}.`);
  return db;
}

export function validateRef(ref) {
  if (!REF_PATTERN.test(ref) || ref.includes('..') || ref.startsWith('/') || ref.startsWith('-')) {
    throw new UsageError(`Invalid --ref "${ref}". Pass a tag (v2.2.1), a branch or a commit SHA.`);
  }
  return ref;
}

/**
 * @param {string[]} argv arguments after the script name
 * @returns {{dir?: string, name?: string, db?: string, ref?: string, template?: string, pm?: string,
 *   install?: boolean, git?: boolean, force: boolean, yes: boolean, help: boolean, version: boolean}}
 */
export function parseArgs(argv) {
  const options = {
    dir: undefined,
    name: undefined,
    db: undefined,
    ref: undefined,
    template: undefined,
    pm: undefined,
    install: undefined,
    git: undefined,
    force: false,
    yes: false,
    help: false,
    version: false,
  };
  const positionals = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--') {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (!arg.startsWith('-') || arg === '-') {
      positionals.push(arg);
      continue;
    }

    const eq = arg.startsWith('--') ? arg.indexOf('=') : -1;
    const flag = eq === -1 ? arg : arg.slice(0, eq);

    if (flag in VALUE_OPTIONS) {
      let value;
      if (eq !== -1) {
        value = arg.slice(eq + 1);
      } else {
        value = argv[i + 1];
        if (value === undefined || (value.startsWith('-') && value !== '-')) {
          throw new UsageError(`${flag} needs a value.`);
        }
        i += 1;
      }
      if (value === '') throw new UsageError(`${flag} needs a value.`);
      options[VALUE_OPTIONS[flag]] = value;
      continue;
    }

    if (flag in FLAG_OPTIONS) {
      if (eq !== -1) throw new UsageError(`${flag} does not take a value.`);
      const [key, value] = FLAG_OPTIONS[flag];
      options[key] = value;
      continue;
    }

    throw new UsageError(`Unknown option "${flag}".`);
  }

  if (positionals.length > 1) {
    throw new UsageError(`Expected one project directory, got: ${positionals.join(' ')}`);
  }
  [options.dir] = positionals;

  if (options.db !== undefined) options.db = normalizeDb(options.db);
  if (options.pm !== undefined && !PACKAGE_MANAGERS.includes(options.pm)) {
    throw new UsageError(`Unknown --pm "${options.pm}". Use one of: ${PACKAGE_MANAGERS.join(', ')}.`);
  }
  if (options.ref !== undefined) validateRef(options.ref);
  if (options.ref !== undefined && options.template !== undefined) {
    throw new UsageError('Use either --ref or --template, not both.');
  }

  return options;
}

export const USAGE = `Usage: create-averoa [project-directory] [options]

Creates a new AveroaJS application from the averoajs boilerplate.

  npm create averoa@latest my-app
  npm create averoa@latest my-app -- --db mysql --no-git
  npx create-averoa my-app --yes

Options:
  --db <sqlite|mysql|postgres>  Database preset written to .env (default: sqlite)
  --name <package-name>         package.json name (default: the directory name)
  --ref <tag|branch|sha>        Boilerplate version to download (default: latest v* tag)
  --template <dir|file|url>     Use a local directory, a .tar.gz file or a tarball URL
                                instead of GitHub (also: CREATE_AVEROA_TEMPLATE)
  --install, --no-install       Install dependencies (default: yes)
  --pm <npm|pnpm|yarn|bun>      Package manager (default: the one running create-averoa)
  --git, --no-git               Create a git repository with an initial commit (default: yes)
  -f, --force                   Write into a directory that is not empty
  -y, --yes                     Accept the defaults without prompting
  -h, --help                    Show this help
  -v, --version                 Show the create-averoa version

With npm, put options after "--" (npm create averoa@latest my-app -- --db mysql),
otherwise npm reads them itself.`;
