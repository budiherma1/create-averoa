<div align="center">

# create-averoa

Create a new AveroaJS application with one command: the boilerplate, a ready `.env` with fresh secrets, a database
preset, dependencies and a first git commit.

[![npm version](https://img.shields.io/npm/v/create-averoa)](https://www.npmjs.com/package/create-averoa)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](#license)
[![node](https://img.shields.io/badge/node-%3E%3D20-339933)](https://nodejs.org)
[![dependencies: 0](https://img.shields.io/badge/dependencies-0-brightgreen)](package.json)
[![part of AveroaJS](https://img.shields.io/badge/part%20of-AveroaJS-6f42c1)](https://github.com/budiherma1/averoajs)

</div>

## Contents

- [Quick start](#quick-start)
- [Usage](#usage)
- [Options](#options)
- [What it does](#what-it-does)
- [Database presets](#database-presets)
- [Choosing the boilerplate version](#choosing-the-boilerplate-version)
- [Environment variables](#environment-variables)
- [Troubleshooting](#troubleshooting)
- [Development](#development)
- [License](#license)

## Quick start

```bash
npm create averoa@latest my-app
cd my-app
npm run migrate:up
npm run seed:run
npm run dev
```

Open <http://localhost:8888>, or call the API:

```bash
curl http://localhost:8888/api
# {"name":"Averoa","version":"2.2.1"}
```

The default preset uses SQLite, so no database server is needed. The seeders create the demo user
`demo@averoa.test` with the password `password`; log in with `POST /api/auth/login`.

## Usage

```bash
npm create averoa@latest [project-directory] [-- options]
npx create-averoa [project-directory] [options]
pnpm create averoa [project-directory] [options]
yarn create averoa [project-directory] [options]
bun create averoa [project-directory] [options]
```

> [!IMPORTANT]
> With `npm create` (npm 7 and later), put the options after `--`. Otherwise npm reads them as its own options; for
> example `--yes` and `--force` are npm options.
>
> ```bash
> npm create averoa@latest my-app -- --db postgres --no-git
> ```

On a terminal, create-averoa asks for everything you did not pass: the project directory, the package name (when
the directory name is not a valid npm name), the database, whether to install dependencies and whether to create a
git repository. Without a terminal (CI, scripts) or with `--yes`, it uses the defaults without asking.

```bash
# accept every default: SQLite, install, git
npx create-averoa my-app --yes

# no install, no git, MySQL preset, a scoped package name
npx create-averoa services/api --db mysql --name @acme/api --no-install --no-git

# scaffold into the current (empty) directory
npx create-averoa .
```

`project-directory` defaults to `averoa-app`. The package name defaults to the directory name; when that is not a
valid npm package name (for example `My Shop`), create-averoa suggests one (`my-shop`) and asks, or uses it directly
without a terminal.

## Options

| Option | Default | Description |
| --- | --- | --- |
| `[project-directory]` | `averoa-app` | Where to create the application, relative to the current directory. `.` is the current directory. |
| `--db <sqlite\|mysql\|postgres>` | `sqlite` | Database preset written to `.env` (see [Database presets](#database-presets)). `better-sqlite3`, `mysql2`, `mariadb`, `pg` and `postgresql` are accepted as aliases. |
| `--name <package-name>` | directory name | `name` in `package.json`, validated against the npm naming rules. Scoped names (`@acme/api`) are allowed. |
| `--ref <tag\|branch\|sha>` | latest `v*` tag | The averoajs version to download, for example `v2.2.1`, `master` or a commit SHA. |
| `--template <dir\|file\|url>` | | Use a local directory, a `.tar.gz` / `.tgz` file or a tarball URL instead of GitHub. Cannot be combined with `--ref`. |
| `--install`, `--no-install` | `--install` | Install dependencies after scaffolding. |
| `--pm <npm\|pnpm\|yarn\|bun>` | the one running the command | Package manager used for the install and in the printed commands. Detected from `npm_config_user_agent`, falling back to npm. |
| `--git`, `--no-git` | `--git` | Run `git init` and create an initial commit. |
| `-f`, `--force` | | Write into a directory that is not empty (see [What it does](#what-it-does)). |
| `-y`, `--yes` | | Do not ask; use the defaults for everything not passed. |
| `-h`, `--help` | | Show the help. |
| `-v`, `--version` | | Show the create-averoa version. |

The exit code is `0` on success, `1` on an error (including a failed dependency install, after the project files
were written) and `130` when you cancel a prompt with Ctrl+C. Cancelling never leaves files behind: every question is
asked before anything is written.

## What it does

1. **Downloads the boilerplate.** It looks up the latest `vX.Y.Z` tag of
   [budiherma1/averoajs](https://github.com/budiherma1/averoajs) with the GitHub API and streams the tag's archive from
   `codeload.github.com` into the system `tar`. Pre-release tags (`v3.0.0-beta.1`) are ignored. The archive has no
   `.git` folder, so the new project starts with no history of the boilerplate.
2. **Prepares `package.json`.** `name` becomes the package name, `version` becomes `0.1.0`, and `"private": true` is
   added so the application cannot be published to npm by accident. The fields that describe the boilerplate
   repository (`description`, `author`, `license`, `repository`, `bugs`, `homepage`, `keywords`, `funding`) and the
   `link:local` script are removed. `package-lock.json` gets the same name and version; it is deleted when you use
   pnpm, yarn or bun.
3. **Removes repository-only files.**

   | Removed | Why |
   | --- | --- |
   | `scripts/link-local.mjs` and the `link:local` npm script | installs local checkouts of the framework packages; only for working on AveroaJS itself |
   | `CHANGELOG.md` | the boilerplate's release history, not your application's |
   | `LICENSE` | the boilerplate's MIT notice; your application is your own project, licensed as you choose |
   | `.github/`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, `FUNDING.yml` | repository CI and community files, when present |
   | `README.md` | replaced by a short README for your project, with the scripts and a link to the AveroaJS guide for the exact version used |

   Everything else is kept: `app/`, `config/`, `database/`, `routes/`, `resources/`, `public/`, `storages/`, `tests/`,
   `workers/`, `server.js`, `averoa.js`, `eslint.config.js`, `.env.example` and `.gitignore`.
4. **Creates `.env`** from `.env.example`, with comments and every other setting kept. `TOKEN_SECRET` and
   `SESSION_SECRET` get new values from `crypto.randomBytes(64)` (the same as `npm run generate:token`), and the
   database preset sets the `DB_*` values. The file is created with mode `0600` (owner read/write) and is ignored by
   the boilerplate's `.gitignore`.
5. **Installs dependencies** with the selected package manager (`npm install`, `pnpm install`, ...).
6. **Creates a git repository** with the commit `Initial commit from create-averoa`. Skipped, with a message, when git
   is not installed, when `user.name` / `user.email` are not configured, or when the directory is already inside a
   git work tree (for example a monorepo). If the commit fails, the new `.git` folder is removed again.
7. **Prints the next steps**, and warns when the running Node.js version does not satisfy the application's
   `engines.node` range.

A directory counts as empty when it contains nothing, or only `.git`, `.DS_Store` or `Thumbs.db`. Any other content
makes create-averoa stop, unless you pass `--force` or confirm the prompt. With `--force`, files with the same names
are overwritten and other files are kept; an existing `.env` is never overwritten (create-averoa warns that it did not
get new secrets).

## Database presets

| `--db` | `.env` | `package.json` | Before `migrate:up` |
| --- | --- | --- | --- |
| `sqlite` (default) | `DB_CLIENT=better-sqlite3`, `DB_NAME=database/dev.sqlite` | `better-sqlite3` moved from `devDependencies` to `dependencies` | nothing; the file is created on first use |
| `mysql` | `DB_CLIENT=mysql2`, `DB_HOST=127.0.0.1`, `DB_PORT=3306`, `DB_NAME=<name>` | `mysql2` is already a dependency | create the database and set `DB_USER` / `DB_PASS` |
| `postgres` | `DB_CLIENT=pg`, `DB_HOST=127.0.0.1`, `DB_PORT=5432`, `DB_NAME=<name>` | `pg` added to `dependencies` | create the database and set `DB_USER` / `DB_PASS` |

`<name>` is derived from the package name: `@acme/my-app` becomes `my_app`. Knex does not create databases, so create
it first, for example `CREATE DATABASE my_app;`.

The SQLite driver is moved to `dependencies` because the application needs it at runtime: a production install
without devDependencies (`npm ci --omit=dev`) would otherwise not have it. For MySQL and PostgreSQL,
`better-sqlite3` stays a devDependency because the boilerplate's tests run on in-memory SQLite.

## Choosing the boilerplate version

By default you get the latest released `v*` tag. Pick another one with `--ref`:

```bash
npx create-averoa my-app --ref v2.0.0      # an older release
npx create-averoa my-app --ref master      # the development branch
```

If the GitHub API cannot be reached (offline, rate limited), create-averoa warns and downloads `v2.2.1`, the latest
version it was released with. Set `GITHUB_TOKEN` to raise the API rate limit.

To work without GitHub, point `--template` (or `CREATE_AVEROA_TEMPLATE`) at a copy of the boilerplate:

```bash
# a local checkout; in a git work tree only the files git would commit are copied
npx create-averoa my-app --template ../averoajs

# an archive you downloaded before, e.g. from https://github.com/budiherma1/averoajs/archive/refs/tags/v2.2.1.tar.gz
npx create-averoa my-app --template ./averoajs-2.2.1.tar.gz

# a tarball URL (https; plain http only for localhost)
npx create-averoa my-app --template https://example.com/averoajs.tar.gz
```

From a directory that is not a git work tree, everything is copied except `.git`, `node_modules`, `.DS_Store` and the
root `.env`. An archive may contain the project at its root or inside one top-level folder, as GitHub archives do.

## Environment variables

| Variable | Description |
| --- | --- |
| `CREATE_AVEROA_TEMPLATE` | Same as `--template`. `--template` and `--ref` take precedence. |
| `GITHUB_TOKEN` / `GH_TOKEN` | Sent to the GitHub API when looking up the latest tag, for a higher rate limit. |
| `NO_COLOR` | Disables colored output. |
| `npm_config_user_agent` | Set by npm, pnpm, yarn and bun; selects the package manager unless `--pm` is passed. |

## Troubleshooting

**My options were ignored with `npm create`.** npm reads options that come before `--` itself. Use
`npm create averoa@latest my-app -- --db mysql`.

**`could not reach the GitHub API` / `rate limited`.** create-averoa falls back to `v2.2.1` and says so. Pass
`--ref <tag>` to choose the version yourself, or set `GITHUB_TOKEN`.

**`could not download https://codeload.github.com/...`.** The machine cannot reach GitHub. Behind a proxy, note that
the `fetch` built into Node.js ignores `HTTPS_PROXY` before Node.js 24 (on 24, set `NODE_USE_ENV_PROXY=1`). Otherwise
download the archive another way and pass it with `--template`.

**`... was not found (404). Check the --ref or --template value.`** The tag, branch or commit does not exist. Tags
start with `v`: `--ref v2.2.1`.

**`the "tar" command was not found`.** The archive is extracted with the system `tar`, which macOS, Linux distributions
and Windows 10 (1803) and later ship. On Windows the built-in `%SystemRoot%\System32\tar.exe` is used even when a
different `tar` (for example from Git for Windows) comes first in `PATH`. On a system without tar, pass a local
directory with `--template`.

**`my-app is not empty`.** Choose another directory, or pass `--force` to write into it. With `npm create`, write
`-- --force`.

**`Skipped git: git user.name / user.email are not configured`.** Configure them
(`git config --global user.name "Your Name"` and `git config --global user.email you@example.com`), then run
`git init && git add -A && git commit -m "Initial commit"` in the project.

**`npm install failed`.** The project files are in place; fix the cause (network, registry, build tools for
`better-sqlite3` on platforms without a prebuilt binary) and run the install again in the project folder.

**The application refuses to start.** `TOKEN_SECRET` is required; check that `.env` exists in the project folder. If
you scaffolded with `--force` into a folder that already had a `.env`, that file was kept as it was: generate secrets
with `npm run generate:token`.

**`AveroaJS needs Node.js ...`.** The boilerplate requires Node.js `^20.19.0 || ^22.13.0 || >=24`. create-averoa
itself runs on Node.js 20 and later, so it can scaffold on an older 20.x or 22.x, but the application will not run
there; upgrade Node.js.

## Development

```bash
npm test                # unit and integration tests, no network
npm run test:network    # downloads the real latest averoajs tag from GitHub
```

The default tests use a fixture template in `test/fixtures/template` and a local HTTP server; they need `tar` and,
for the git tests, `git`. The package has no runtime dependencies: Node.js built-ins (`fetch`, `node:readline`,
`node:crypto`, `node:child_process`) plus the system `tar`, which avoids shipping an archive library for a single
extraction.

## License

[MIT](LICENSE) © 2026 Budi Hermawan ([@budiherma1](https://github.com/budiherma1))
