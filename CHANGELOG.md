## [0.1.3](https://github.com/Vladimir-Romanets/import-atlas/compare/v0.1.2...v0.1.3) (2026-09-08)


### Bug Fixes

* resolve non-relative imports against explicit tsconfig baseUrl ([#7](https://github.com/Vladimir-Romanets/import-atlas/issues/7)) ([77df847](https://github.com/Vladimir-Romanets/import-atlas/commit/77df84750e9f7cfa23c94a9a3f74a037d1081c23))

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.2] - 2026-09-08

### Changed

- Graph viewer's client-side code (the HTML/CSS/JS embedded in the generated report) is now authored as TypeScript modules under `src/render/` instead of inline template-literal strings in `render.ts`, and is type-checked, bundled, and minified with esbuild at build time. No change in the generated report's behavior.
- Moved development setup instructions from README.md into a new CONTRIBUTING.md.

## [0.1.1] - 2026-09-07

### Fixed

- Graph view: the warning glyph no longer overlaps the reference-node glyph on nodes that are both a shared reference and have an unresolved import.

## [0.1.0] - 2026-09-04

### Added

- Initial release.
- `scan` command — parse a JS/TS project's local import graph from one or more entry files and dump it as JSON.
- `graph` command — render the scanned graph as an interactive, pannable HTML dependency tree.
- AST-based import/export/dynamic-`import()`/`require()` resolution via the TypeScript compiler API.
- `tsconfig.json` `paths` alias resolution, including `extends` chains.
- Shared-file reference nodes instead of duplicated subtrees, with import cycle detection.
- Layer-based node coloring derived from the first path segment under `src/` (or the project root).
- Library API: `scan()`, `buildForest()`, `renderHtml()`.
