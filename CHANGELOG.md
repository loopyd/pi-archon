# Changelog

All notable changes to this project will be documented in this file.

## [0.0.8] - 2026-05-04

### Fixed
- Fixed package type import to use public `@mariozechner/pi-tui` surface instead of private `dist/tui.js` path so CI and publish workflows can typecheck on clean runners.

## [0.0.7] - 2026-05-04

### Added
- New command architecture under `src/commands/` with shared command base and static command tree wiring.
- New handler split under `src/handlers/` for manage, runtime, server, web, workflow, and maintenance flows.
- New TUI layer under `src/ui/` with shared panel rendering, progress boxes, run boxes, and message panels.
- New shared config and type surfaces in `src/config.ts`, `src/runtime-util.ts`, `src/types.d.ts`, and `src/workflow-discovery.ts`.
- New `src/archon-dispatch.ts` route/dispatch layer.

### Changed
- Refactored command registration and routing to reduce duplication and centralize workflow dispatch.
- Reworked workflow run TUI behavior so cancel uses actual Archon workflow abandonment instead of only closing local UI.
- Improved TUI rendering for live and completed workflow output:
  - right-side internal panel padding preserved
  - transparent gutter preserved
  - heading/body wrapping improved
  - separator lines no longer truncate
  - final expanded output respects panel padding
  - wrapped heading indentation aligns from em dash when present, otherwise defaults to four spaces
  - lone `Esc` cancels while regular keypresses do not accidentally abort
- Removed older monolithic command/runtime UI files in favor of split modules.

### Fixed
- Fixed `command:archon` startup/runtime error `Cannot access 'cachedLog' before initialization`.
- Fixed workflow cancel path leaving Archon runs active after TUI abort.
- Fixed extra bottom cancel notification outside progress box.
- Fixed title/log wrapping regressions in finished workflow panels.

### Release history
- `0.0.6` - 2026-05-04 - https://github.com/loopyd/pi-archon/compare/v0.0.5...v0.0.6
- `0.0.5` - 2026-05-02 - https://github.com/loopyd/pi-archon/compare/v0.0.4...v0.0.5
- `0.0.4` - 2026-05-02 - https://github.com/loopyd/pi-archon/compare/v0.0.3...v0.0.4
- `0.0.3` - 2026-05-02 - https://github.com/loopyd/pi-archon/compare/v0.0.2...v0.0.3
- `0.0.2` - 2026-05-02

[0.0.8]: https://github.com/loopyd/pi-archon/compare/v0.0.7...v0.0.8
[0.0.7]: https://github.com/loopyd/pi-archon/compare/v0.0.6...v0.0.7
