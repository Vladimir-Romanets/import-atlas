# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-09-04

### Added

- Initial release.
- `scan` command — parse a JS/TS project's local import graph from one or
  more entry files and dump it as JSON.
- `graph` command — render the scanned graph as an interactive, pannable
  HTML dependency tree.
- AST-based import/export/dynamic-`import()`/`require()` resolution via the
  TypeScript compiler API.
- `tsconfig.json` `paths` alias resolution, including `extends` chains.
- Shared-file reference nodes instead of duplicated subtrees, with import
  cycle detection.
- Layer-based node coloring derived from the first path segment under
  `src/` (or the project root).
- Library API: `scan()`, `buildForest()`, `renderHtml()`.
