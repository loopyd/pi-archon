# @saber7ooth/pi-archon

Opinionated Archon workflow extension package for Pi.

This package lifts the local Archon integration out of a single repo and ships it as a reusable Pi package. It provides the `/archon` command surface, the Archon route handler used by RPC/tool flows, and the custom Archon message renderer.

## Install

From GitHub while iterating:

```bash
pi install -l git:github.com/loopyd/pi-archon
```

From npm after the package is published:

```bash
pi install -l npm:@saber7ooth/pi-archon
```

## Runtime Requirements

- Pi with package support.
- An Archon CLI available on `PATH` as `archon`, or a Bun checkout at `ARCHON_ROOT`.
- Default `ARCHON_ROOT` is `/opt/archon`.
- Default `ARCHON_HOME` is project `.archon` when present, otherwise `~/.archon`.

This package is intentionally tuned to the author's Archon workflow names:

- `bof3-plan`
- `bof3-implement`
- `bof3-validate`
- `bof3-piv`

## Commands

- `/archon plan <query>`
- `/archon implement <query>`
- `/archon validate <query>`
- `/archon status`
- `/archon cleanup`
- `/archon web <start|stop|status>`

## Development

```bash
npm install
npm test
```

## Publishing

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
3. Keep the GitHub repository public so npm can generate provenance automatically for trusted publishes.
4. Keep the package scoped public. This repo sets public access in `package.json`, and the workflow publishes with public access.

Release flow:

```bash
npm version patch
git push origin master --follow-tags
```

Pushing a `v*` tag triggers `.github/workflows/publish.yml`, which runs the package checks and publishes with public access.

## License

MIT