# [0.4.0](https://github.com/Vladimir-Romanets/import-atlas/compare/v0.3.0...v0.4.0) (2026-09-10)


### Bug Fixes

* drop import edges to files the --max-files cap left unread ([8ee7a6d](https://github.com/Vladimir-Romanets/import-atlas/commit/8ee7a6d5b94fa05f448fe6390eaa07a082dfee2b))


### Features

* hide barrel re-exports that nothing imports by name ([97dbb45](https://github.com/Vladimir-Romanets/import-atlas/commit/97dbb45c9ba6e339f01bac14b8e588c78f0e3e06))

# [0.3.0](https://github.com/Vladimir-Romanets/import-atlas/compare/v0.2.0...v0.3.0) (2026-09-09)


### Features

* collapse duplicate import edges and surface a consolidation hint ([#10](https://github.com/Vladimir-Romanets/import-atlas/issues/10)) ([c98e669](https://github.com/Vladimir-Romanets/import-atlas/commit/c98e669f760e9c52fff4a3edc0bf48d35dfc9cea))

# [0.2.0](https://github.com/Vladimir-Romanets/import-atlas/compare/v0.1.3...v0.2.0) (2026-09-08)


### Features

* show folder name under index node labels ([#8](https://github.com/Vladimir-Romanets/import-atlas/issues/8)) ([f896e1f](https://github.com/Vladimir-Romanets/import-atlas/commit/f896e1facc300d99571f61cbda26228b6401c18d))

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
