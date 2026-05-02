<!-- markdownlint-disable MD033 MD041 -->
<p align="center">
    <a href="https://github.com/coleam00/Archon">
        <img src="assets/logo.png" alt="Archon" height="84" />
    </a>
    <span>&nbsp;&nbsp;&nbsp;</span>
    <a href="https://pi.dev">
        <img src="assets/pi-logo.png" alt="Pi" height="84" />
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
    A friendly Pi Coding Agent extension for running Archon workflows inside your project.
</p>
<!-- markdownlint-enable MD033 MD041 -->

This package adds an `/archon` command to Pi so you can use Archon workflows without leaving your Pi session.

If you already like the original [Archon](https://github.com/coleam00/Archon) project and want a smoother day-to-day experience inside Pi, this package is the bridge.

## Table of Contents

- [Table of Contents](#table-of-contents)
- [What You Get](#what-you-get)
- [Before You Install](#before-you-install)
- [Install With Pi](#install-with-pi)
- [Use It In Pi](#use-it-in-pi)
- [Helpful Commands](#helpful-commands)
  - [Workflow Commands](#workflow-commands)
  - [Project Commands](#project-commands)
  - [Server and Web Commands](#server-and-web-commands)
- [Install From Another Source](#install-from-another-source)
- [Good To Know](#good-to-know)
- [License](#license)

## What You Get

- A ready-to-use `/archon` command inside Pi.
- Fast workflow shortcuts for planning, implementation, and validation.
- Handy project helpers for status, cleanup, server, and web tasks.
- A setup that works naturally with an existing Archon workspace.

## Before You Install

You will want these in place first:

1. Pi Coding Agent installed.
2. A working Archon setup or Archon CLI on your machine.
3. A project where you want Pi and Archon to work together.

If you do not have Pi yet, install it with:

```bash
npm install -g @mariozechner/pi-coding-agent
```

Then open Pi in your project and sign in with `/login` or your preferred provider setup.

## Install With Pi

From your project folder, run:

```bash
pi install -l npm:@saber7ooth/pi-archon
```

Then reload Pi:

```text
/reload
```

To confirm the extension loaded, run:

```text
/archon help
```

## Use It In Pi

Most people will start here:

```text
/archon plan add a deployment checklist
/archon implement wire this feature into the dashboard
/archon validate review the changes and look for gaps
```

That gives you the basic Archon loop inside Pi without extra setup noise.

## Helpful Commands

Here are the commands you are most likely to use.

### Workflow Commands

- `/archon plan <your request>`
- `/archon implement <your request>`
- `/archon validate <your request>`

### Project Commands

- `/archon status` checks whether the project looks ready.
- `/archon cleanup` runs the cleanup pipeline.
- `/archon sync-submodules` updates submodules.

### Server and Web Commands

- `/archon server start`
- `/archon server status`
- `/archon server stop`
- `/archon web start`
- `/archon web status`
- `/archon web stop`

## Install From Another Source

If you would rather install from git or from a local path, Pi supports that too.

From git:

```bash
pi install -l git:github.com/loopyd/pi-archon
```

From a local folder:

```bash
pi install -l /absolute/path/to/pi-archon
```

For one-off local testing:

```bash
pi -e /absolute/path/to/pi-archon
```

## Good To Know

- This package does not bundle Archon itself. You still need Archon available locally.
- The cleanup command is powerful and can change your git state, so use it intentionally.
- Pi packages run with full system access, so only install packages you trust.
- If you want the upstream project, start with [coleam00/Archon](https://github.com/coleam00/Archon).

## License

MIT
