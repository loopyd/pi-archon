<!-- markdownlint-disable MD033 MD041 -->
<p align="center">
    <a href="https://github.com/coleam00/Archon">
        <img src="assets/logo.png" alt="Archon" height="84" />
    </a>
    <span>&nbsp;&nbsp;&nbsp;</span>
    <a href="https://pi.dev">
        <img src="assets/pi-logo.svg" alt="Pi" height="84" />
    </a>
</p>

<h1 align="center">pi-archon</h1>

<p align="center">
    <a href="https://github.com/loopyd/pi-archon/releases/latest">
        <img src="https://img.shields.io/github/v/release/loopyd/pi-archon?style=for-the-badge&logo=github&label=release" alt="GitHub release" />
    </a>
    <a href="https://www.npmjs.com/package/@saber7ooth/pi-archon">
        <img src="https://img.shields.io/npm/v/%40saber7ooth%2Fpi-archon?style=for-the-badge&logo=npm&label=npm" alt="npm version" />
    </a>
</p>

<p align="center">
    Pi extension package for <a href="https://github.com/coleam00/Archon">coleam00/Archon</a>.
</p>
<!-- markdownlint-enable MD033 MD041 -->

This package lifts a local Archon integration into a reusable Pi package. It offers:

- `/archon` slash command with grouped subcommands and argument completion.
- A `POST /archon` route for host or RPC-driven integrations
- Archon-specific message formatting for status and operational output.
- workflow, cleanup, server, and web helpers tuned for the author's Archon layout.

## Pi Setup

Pi package and extension behavior comes from Pi itself, not from this package. Based on the current Pi docs at `pi.dev`:

1. Install Pi:

```bash
npm install -g @mariozechner/pi-coding-agent
```

1. Start Pi once in a project and authenticate with either:

```text
/login
```

or a provider API key such as `ANTHROPIC_API_KEY`.

1. Install this package into the current project so the `/archon` command becomes part of that repo's Pi setup:

```bash
pi install -l npm:@saber7ooth/pi-archon
```

Useful alternatives:

```bash
pi install -l git:github.com/loopyd/pi-archon
pi install -l /absolute/path/to/pi-archon
pi -e /absolute/path/to/pi-archon
```

1. Reload Pi resources in the current session:

```text
/reload
```

1. Verify the package loaded:

```text
/archon help
```

Pi notes relevant to this package:

- `pi install -l ...` writes to project-local `.pi/settings.json`.
- project-local packages are auto-installed on startup when Pi sees them in project settings
- `pi list` shows installed packages
- `pi config` can enable or disable package resources
- Pi packages and extensions run with full system access; only install sources you trust

## Runtime Setup

This extension does not bundle Archon itself. It expects a working Archon runtime next to Pi.

### Archon Invocation Resolution

When the extension needs to run Archon workflows, it resolves the command like this:

1. If `${ARCHON_ROOT}/package.json` exists, it runs:

```bash
bun run cli ...
```

from `ARCHON_ROOT`.

1. Otherwise it falls back to:

```bash
archon ...
```

from the current project directory.

Defaults and environment resolution:

- `ARCHON_ROOT` defaults to `/opt/archon`
- `ARCHON_HOME` resolves in this order: project-local `.archon/`, then `ARCHON_ROOT/.env`, then the `ARCHON_HOME` environment variable, then `~/.archon`

### Project Layout Expected By Commands

The extension reads these locations when present:

- `.archon/workflows/*.yaml` for status reporting
- `.pi/agents/*.md` for Pi agent discovery in status output
- `.archon/config.yaml` for the default web assistant binding (`assistant:` or `provider:`)
- `tmp/` in the project root for server and web pid/log files

### Additional Requirements For Server And Web Commands

The server and web helpers assume the Archon checkout contains the backend and frontend dev commands and supporting assets:

- `bun run dev:server` in `ARCHON_ROOT`
- `bun run dev:web` in `ARCHON_ROOT`
- `sqlite3` available on `PATH`
- `ARCHON_ROOT/archon.db` present for codebase-to-assistant binding
- backend health endpoint available at `http://127.0.0.1:3090/api/health`

## Install Sources

Project-local install from npm:

```bash
pi install -l npm:@saber7ooth/pi-archon
```

Project-local install from git:

```bash
pi install -l git:github.com/loopyd/pi-archon
```

Global install:

```bash
pi install npm:@saber7ooth/pi-archon
```

Pi also supports local-path installs and temporary `-e/--extension` loading for testing.

## Command Reference

The extension exposes one top-level slash command:

```text
/archon
```

Pi will also show completions for subcommands because the package builds them from the live command tree.

### Top-Level Shorthand And Aliases

These shortcuts are intentionally supported:

- `/archon plan ...`
- `/archon implement ...`
- `/archon validate ...`
- `/archon status`
- `/archon cleanup`
- `/archon clean`
- `/archon sync-submodules`
- `/archon api start|stop|status` as an alias for `/archon server ...`

Canonical grouped forms are also supported and are documented below.

### Workflow Commands

`/archon plan <query>`

- canonical grouped form: `/archon workflow plan <query>`
- runs Archon workflow id `bof3-plan`
- always requires a query in the command metadata

`/archon implement [query]`

- canonical grouped form: `/archon workflow implement [query]`
- runs Archon workflow id `bof3-implement`
- if the query is omitted, the current implementation falls back to the extension default query `decompile the next function`

`/archon validate [query]`

- canonical grouped form: `/archon workflow validate [query]`
- runs Archon workflow id `bof3-validate`
- if the query is omitted, the current implementation falls back to the same default query

All workflow commands execute the equivalent Archon CLI call:

```bash
archon workflow run <workflow-name> <query> --no-worktree --cwd <project>
```

or the Bun-based equivalent when `ARCHON_ROOT` points at an Archon checkout.

Operational notes:

- workflows render progress in Pi's UI when a TUI is available
- workflow output is formatted into markdown summaries for command and tool/RPC use
- `--no-worktree` is always passed by this extension

Examples:

```text
/archon plan add a deployment checklist to the CI docs
/archon implement wire the docs updates into the release process
/archon validate compare the generated release notes with the tag diff
```

### Management Commands

`/archon status`

- canonical grouped form: `/archon manage status`
- reports the project cwd, Archon root detection, discovered `.archon` workflows, and discovered `.pi/agents` entries

`/archon cleanup [--verbose|-v] [--dry-run]`

- canonical grouped form: `/archon manage cleanup [flags]`
- alias: `/archon clean`
- runs a multi-step cleanup pipeline that can mutate both the superproject and submodules

Current cleanup pipeline steps:

1. fetch `origin` for the superproject
2. roll up local uncommitted changes
3. push ahead commits to `origin/master`
4. clean stale worktrees, local branches, remote refs, and stashes
5. inspect submodule health
6. sync submodules to remote defaults
7. audit submodule branch hygiene
8. prune stale branches in owned repos
9. surface feature candidates across third-party tools

Important safety note:

- `cleanup` is not a passive report command
- it can commit local changes, push to `origin/master`, delete stale refs, update submodules, and commit submodule pointer changes
- the command surface accepts `--dry-run`, but the current implementation still executes the live cleanup steps; do not treat it as a safe preview mode yet

`/archon sync-submodules`

- canonical grouped form: `/archon manage sync-submodules`
- fetches each submodule
- checks the remote default branch
- syncs behind submodules by checking out `origin/<default-branch>`
- pushes ahead submodules back to `origin/<default-branch>`
- commits changed submodule pointers in the superproject when needed

### Server Commands

`/archon server start`

- alias group form: `/archon api start`
- launches `bun run dev:server` from `ARCHON_ROOT`
- writes log output to `tmp/archon-server-dev.log`
- writes the pid to `tmp/archon-server-dev.pid`
- waits for `http://127.0.0.1:3090/api/health`

`/archon server stop`

- alias group form: `/archon api stop`
- terminates matching Archon server processes and their process groups
- clears the pid file

`/archon server status`

- alias group form: `/archon api status`
- reports Archon home resolution, backend health, and recent server logs

Examples:

```text
/archon server start
/archon server status
/archon server stop
```

### Web Commands

`/archon web start [--assistant <id>] [--open]`

- checks whether the backend API on port `3090` is reachable
- uses `.archon/config.yaml` `assistant:` or `provider:` when present, otherwise defaults to `pi`
- records or updates a codebase-to-assistant binding in `ARCHON_ROOT/archon.db`
- launches `bun run dev:web` from `ARCHON_ROOT`
- writes log output to `tmp/archon-web-dev.log`
- writes the pid to `tmp/archon-web-dev.pid`
- parses the UI port from the Vite log, defaulting to `5173`

About `--open`:

- the current implementation includes the UI link in command output when `--open` is passed
- it does not currently shell out to a browser opener

`/archon web stop`

- kills matching Archon frontend processes and clears the pid file

`/archon web status`

- reports Archon home resolution, frontend reachability, backend reachability, the current UI endpoint, and recent web logs

Examples:

```text
/archon web start
/archon web start --assistant pi --open
/archon web status
/archon web stop
```

### Help

The package supports both global and scoped help:

```text
/archon help
/archon workflow --help
/archon cleanup --help
/archon server --help
/archon web --help
```

## Route And Tool Integration

The extension also registers a route handler at:

```text
POST /archon
```

Expected body shape:

```json
{
   "command": "plan",
   "args": "summarize the release workflow",
   "options": {}
}
```

Supported route commands in the current implementation:

- `plan`
- `implement`
- `validate`
- `status`
- `cleanup`
- `clean`
- `web ...`
- `help`

Tool-mode notes:

- workflow tool calls return structured markdown plus execution details
- status returns a markdown summary of workflows and agents
- cleanup route mode currently returns a simplified queued summary instead of the full interactive pipeline

## Development

Install dependencies and run the package checks:

```bash
npm install
npm test
```

The package exports `./src/index.ts` through the Pi manifest, so local path installs and Pi package loading use the TypeScript source directly.

## Publishing And Releases

Pi package discovery is automatic once the package is published to npm because this repo includes:

- the `pi-package` keyword
- a `pi.extensions` manifest
- a public npm package name under `@saber7ooth/pi-archon`

There is no separate manual Pi package index submission step.

This repo is configured for npm trusted publishing from GitHub Actions.

One-time npm setup:

1. Create or claim the npm package `@saber7ooth/pi-archon` in the `@saber7ooth` npm organization.
2. From the `@saber7ooth` org package settings on npm, add a trusted publisher for:
    - GitHub owner: `loopyd`
    - Repository: `pi-archon`
    - Workflow filename: `publish.yml`
    - Environment name: `npm-publish`
3. Keep the GitHub repository public so npm can generate provenance automatically for trusted publishes.
4. Keep the package scoped public. This repo sets public access in `package.json`, and the workflow publishes with public access.

Release flow:

```bash
npm version patch
git push origin master --follow-tags
```

Pushing a `v*` tag triggers `.github/workflows/release.yml`, which creates the matching GitHub Release and syncs `package.json` on `master` to the tagged version when needed.

The same `v*` tag also triggers `.github/workflows/publish.yml`, which runs the package checks and publishes with public access from the `npm-publish` GitHub environment.

If the tagged version is already present on npm, the workflow skips the publish step so reruns can still verify the release path without failing on a duplicate version.

If the GitHub Release already exists or `package.json` already matches the tag version, the release workflow skips the duplicate work so reruns stay safe.

If a publish fails, rerun the existing workflow run or dispatch `publish.yml` against the release tag ref so the same trusted publisher configuration is used.

## License

MIT
