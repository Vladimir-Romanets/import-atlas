# [1.2.0](https://github.com/Vladimir-Romanets/import-atlas/compare/v1.1.0...v1.2.0) (2026-09-17)


### Features

* add layer-violation findings, layer-rules config, and init-rules command ([#34](https://github.com/Vladimir-Romanets/import-atlas/issues/34)) ([203e7a5](https://github.com/Vladimir-Romanets/import-atlas/commit/203e7a50b4681dbd91b2d7778496d179e36d6f49))

# [1.1.0](https://github.com/Vladimir-Romanets/import-atlas/compare/v1.0.0...v1.1.0) (2026-09-17)


### Features

* highlight a node's layer in the sidebar legend on hover ([#32](https://github.com/Vladimir-Romanets/import-atlas/issues/32)) ([3ab2ccd](https://github.com/Vladimir-Romanets/import-atlas/commit/3ab2ccdf515e6747a599b737398c74e23da2a02b))

# [1.0.0](https://github.com/Vladimir-Romanets/import-atlas/compare/v0.15.0...v1.0.0) (2026-09-16)


* refactor!: rename CLI commands graph→tree and merged→graph ([#30](https://github.com/Vladimir-Romanets/import-atlas/issues/30)) ([a137e96](https://github.com/Vladimir-Romanets/import-atlas/commit/a137e961b84349adf149e1ca02fa369aaee3208c))


### BREAKING CHANGES

* `import-atlas graph` now writes the graph, not the tree — the old invocation keeps working and silently produces a different report. `import-graph.html` likewise now holds the graph. The library's `renderGraphHtml` keeps its name but renders the graph and takes a `buildGraph` result; tree callers must move to `renderTreeHtml`. See docs/migrations/0.15-to-1.0.md.

# [0.15.0](https://github.com/Vladimir-Romanets/import-atlas/compare/v0.14.0...v0.15.0) (2026-09-15)


### Features

* recognize the merged hover-edge-raise feature for release ([#29](https://github.com/Vladimir-Romanets/import-atlas/issues/29)) ([877cdc7](https://github.com/Vladimir-Romanets/import-atlas/commit/877cdc7944befaacfc6b510b79fb7f18a7faaa12)), closes [#28](https://github.com/Vladimir-Romanets/import-atlas/issues/28) [#28](https://github.com/Vladimir-Romanets/import-atlas/issues/28)

# [0.14.0](https://github.com/Vladimir-Romanets/import-atlas/compare/v0.13.1...v0.14.0) (2026-09-15)


### Features

* add new logo and refresh report/README branding ([#27](https://github.com/Vladimir-Romanets/import-atlas/issues/27)) ([ead29a6](https://github.com/Vladimir-Romanets/import-atlas/commit/ead29a60d97c3b26b7bfca30f67788d30f40f0b7))

## [0.13.1](https://github.com/Vladimir-Romanets/import-atlas/compare/v0.13.0...v0.13.1) (2026-09-15)


### Bug Fixes

* walk deep import chains without overflowing the call stack ([#25](https://github.com/Vladimir-Romanets/import-atlas/issues/25)) ([05fce41](https://github.com/Vladimir-Romanets/import-atlas/commit/05fce41c865a48bfd5a13fa46b449b51eada7629))

# [0.13.0](https://github.com/Vladimir-Romanets/import-atlas/compare/v0.12.0...v0.13.0) (2026-09-14)


### Features

* add the merged graph viewer ([#24](https://github.com/Vladimir-Romanets/import-atlas/issues/24)) ([dc064a0](https://github.com/Vladimir-Romanets/import-atlas/commit/dc064a066005976881d2309919e10724069fc210))

# [0.12.0](https://github.com/Vladimir-Romanets/import-atlas/compare/v0.11.0...v0.12.0) (2026-09-14)


### Features

* circle the tree chevron and print scan progress ([#23](https://github.com/Vladimir-Romanets/import-atlas/issues/23)) ([6f11eea](https://github.com/Vladimir-Romanets/import-atlas/commit/6f11eeaad88b56e2416fa312c00cd6ef3a9ee4a6))

# [0.11.0](https://github.com/Vladimir-Romanets/import-atlas/compare/v0.10.1...v0.11.0) (2026-09-13)


### Features

* report circular imports one loop per row ([49dc688](https://github.com/Vladimir-Romanets/import-atlas/commit/49dc688623987ea415aee238886042e7d2156da5))
* widen the layer palette and enlarge legend swatches ([6b01c24](https://github.com/Vladimir-Romanets/import-atlas/commit/6b01c24732d0934bd205ce895cf64a8ca8a7710c))

## [0.10.1](https://github.com/Vladimir-Romanets/import-atlas/compare/v0.10.0...v0.10.1) (2026-09-13)


### Bug Fixes

* anchor circular-import path at fileId via shortest-cycle BFS ([#20](https://github.com/Vladimir-Romanets/import-atlas/issues/20)) ([74b6a48](https://github.com/Vladimir-Romanets/import-atlas/commit/74b6a481f9d3bbcae4f2c1102f39dfd7bdf1ebea))

# [0.10.0](https://github.com/Vladimir-Romanets/import-atlas/compare/v0.9.0...v0.10.0) (2026-09-11)


### Features

* add circular and duplicate import detectors to Findings ([#19](https://github.com/Vladimir-Romanets/import-atlas/issues/19)) ([577255a](https://github.com/Vladimir-Romanets/import-atlas/commit/577255a5cd3cdb17a4466bbbeaa142eb8861f5b0)), closes [hi#confidence](https://github.com/hi/issues/confidence)

# [0.9.0](https://github.com/Vladimir-Romanets/import-atlas/compare/v0.8.0...v0.9.0) (2026-09-11)


### Features

* add a help icon with context for each findings group ([#18](https://github.com/Vladimir-Romanets/import-atlas/issues/18)) ([dae27e4](https://github.com/Vladimir-Romanets/import-atlas/commit/dae27e4c46d8196a2f5d8340fe35759a99c906aa))

# [0.8.0](https://github.com/Vladimir-Romanets/import-atlas/compare/v0.7.0...v0.8.0) (2026-09-11)


### Features

* open a re-used node where it stands ([#17](https://github.com/Vladimir-Romanets/import-atlas/issues/17)) ([9895b7f](https://github.com/Vladimir-Romanets/import-atlas/commit/9895b7f30098a1007337170bb32caa2385e8524f))

# [0.7.0](https://github.com/Vladimir-Romanets/import-atlas/compare/v0.6.0...v0.7.0) (2026-09-10)


### Features

* narrow a barrel's children to what its importer asked for ([#16](https://github.com/Vladimir-Romanets/import-atlas/issues/16)) ([70d3b0a](https://github.com/Vladimir-Romanets/import-atlas/commit/70d3b0a730f123d0de61e745b2c8a44947bfa329))

# [0.6.0](https://github.com/Vladimir-Romanets/import-atlas/compare/v0.5.0...v0.6.0) (2026-09-10)


### Features

* drop the unused-re-export render mode ([#15](https://github.com/Vladimir-Romanets/import-atlas/issues/15)) ([c2413d6](https://github.com/Vladimir-Romanets/import-atlas/commit/c2413d6ca6577b247300a288df9e4a47e962213f))

# [0.5.0](https://github.com/Vladimir-Romanets/import-atlas/compare/v0.4.1...v0.5.0) (2026-09-10)


### Features

* list exports nothing imports in a Findings tab ([#14](https://github.com/Vladimir-Romanets/import-atlas/issues/14)) ([bc42059](https://github.com/Vladimir-Romanets/import-atlas/commit/bc4205980667fe3f1cd9d2feb1ef205fcbf84e63))

## [0.4.1](https://github.com/Vladimir-Romanets/import-atlas/compare/v0.4.0...v0.4.1) (2026-09-10)


### Bug Fixes

* keep node labels inside their box, restyle layer marker ([#12](https://github.com/Vladimir-Romanets/import-atlas/issues/12)) ([8b78805](https://github.com/Vladimir-Romanets/import-atlas/commit/8b78805eb142012445f56e1c16f18f9182e03775))

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
