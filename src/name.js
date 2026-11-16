import { builtinModules } from 'node:module';

const RESERVED = new Set(['node_modules', 'favicon.ico']);
const BUILTINS = new Set(builtinModules.map((m) => m.replace(/^node:/, '')));

/**
 * Checks a name against the npm rules for new packages (the same rules as
 * validate-npm-package-name): at most 214 characters, lowercase, URL safe, no
 * leading `.` or `_`, not a Node.js core module, optionally `@scope/name`.
 *
 * @param {string} name
 * @returns {{ valid: boolean, problems: string[] }}
 */
export function validatePackageName(name) {
  const problems = [];
  if (typeof name !== 'string' || name.length === 0) {
    return { valid: false, problems: ['name cannot be empty'] };
  }
  if (name.trim() !== name) problems.push('name cannot start or end with spaces');
  if (name.length > 214) problems.push('name cannot be longer than 214 characters');
  if (name.startsWith('.')) problems.push('name cannot start with a period');
  if (name.startsWith('_')) problems.push('name cannot start with an underscore');
  if (name.toLowerCase() !== name) problems.push('name must be lowercase');
  if (/[~'!()*]/.test(name.split('/').slice(-1)[0])) {
    problems.push('name cannot contain the characters ~\'!()*');
  }
  if (RESERVED.has(name.toLowerCase())) problems.push(`"${name}" is a reserved name`);
  if (BUILTINS.has(name.toLowerCase())) problems.push(`"${name}" is a Node.js core module name`);

  const scoped = /^@([^/]+)\/([^/]+)$/.exec(name);
  const parts = scoped ? [scoped[1], scoped[2]] : [name];
  if (!scoped && name.includes('/')) {
    problems.push('name can only contain a slash as @scope/name');
  } else if (parts.some((p) => encodeURIComponent(p) !== p)) {
    problems.push('name can only contain URL-friendly characters (a-z, 0-9, -, ., _, ~)');
  } else if (scoped && (parts[1].startsWith('.') || parts[1].startsWith('_'))) {
    problems.push('name cannot start with a period or an underscore after the scope');
  }

  return { valid: problems.length === 0, problems };
}

/** Turns a directory name such as "My App" into a valid package name ("my-app"). */
export function toValidPackageName(input) {
  const name = String(input)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/^[._]+/, '')
    .replace(/[^a-z\d\-.]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 214);
  if (!name || !validatePackageName(name).valid) return 'averoa-app';
  return name;
}

/** Database name for the MySQL / PostgreSQL presets: "@acme/my-app" -> "my_app". */
export function databaseName(packageName) {
  const base = String(packageName).replace(/^@[^/]+\//, '');
  let name = base.toLowerCase().replace(/[^a-z\d]+/g, '_').replace(/^_+|_+$/g, '');
  if (!name) return 'averoa';
  if (/^\d/.test(name)) name = `db_${name}`;
  return name.slice(0, 63);
}
