# Changelog

## 1.1.1

### Changed

- Releases are published from GitHub Actions with npm trusted publishing (OIDC, no token secret) and carry an npm
  provenance statement. No code changes.

## 1.1.0

### Added

- **Starters.** `--starter <name>` (or the new prompt, on a terminal) creates the app from one of the boilerplate's
  starters instead of the full boilerplate: `minimal` (authentication and users, no examples) or `dashboard` (admin
  pages with a session login). Starters come from the downloaded release's `starters/` folder (AveroaJS 2.5.0 and
  later), are applied before the usual preparation, and the folder itself is not copied into the app. An unknown
  starter lists the available ones; nothing is written.
- The project README names the starter.

### Changed

- The offline fallback version is `v2.5.0` (was `v2.2.1`).

## 1.0.0

First release.

- `npm create averoa@latest my-app` (or `npx create-averoa my-app`) creates a new AveroaJS application from the
  [averoajs](https://github.com/budiherma1/averoajs) boilerplate.
- Downloads the latest `v*` tag of averoajs from GitHub (`--ref` picks another tag, branch or commit; when the GitHub
  API cannot be reached the bundled default `v2.2.1` is used, with a warning). `--template` or
  `CREATE_AVEROA_TEMPLATE` use a local directory, a `.tar.gz` file or a tarball URL instead.
- Prepares the project: `package.json` gets the project name (validated against the npm naming rules), version
  `0.1.0` and `"private": true`; repository-only files (`scripts/link-local.mjs` and the `link:local` script,
  `CHANGELOG.md`, `LICENSE`, `.github/`) are removed; `README.md` is replaced by a short project README.
- Creates `.env` from `.env.example` with freshly generated `TOKEN_SECRET` and `SESSION_SECRET` (64 random bytes each,
  file mode `0600`).
- `--db sqlite|mysql|postgres` presets. SQLite is the default and needs no database server; its driver
  `better-sqlite3` is moved to `dependencies`. PostgreSQL adds `pg`.
- Optional dependency install with the package manager that runs the command (npm, pnpm, yarn or bun; `--pm` to
  override) and an optional git repository with an initial commit.
- Interactive prompts on a terminal (`node:readline`), `--yes` to accept the defaults. Refuses to write into a
  non-empty directory without `--force`.
- No runtime dependencies. Archives are extracted with the system `tar` (macOS, Linux, Windows 10 and later).
