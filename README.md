<div align="center" style="background-color: #0a121d">
  <img src="./docs/thumb.png" width="640px" title="import-atlas" alt="import-atlas - Scan the local import graph of a JavaScript or TypeScript project" />
</div>
<div align="center">

[![npm version](https://img.shields.io/npm/v/import-atlas.svg)](https://www.npmjs.com/package/import-atlas)
[![CI](https://github.com/Vladimir-Romanets/import-atlas/actions/workflows/ci.yml/badge.svg)](https://github.com/Vladimir-Romanets/import-atlas/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/npm/l/import-atlas.svg)](https://github.com/Vladimir-Romanets/import-atlas/blob/main/LICENSE)
[![Downloads](https://img.shields.io/npm/dm/import-atlas.svg)](https://www.npmjs.com/package/import-atlas)
[![Types](https://img.shields.io/npm/types/import-atlas.svg)](https://www.npmjs.com/package/import-atlas)
[![Node engines](https://img.shields.io/node/v/import-atlas.svg)](https://www.npmjs.com/package/import-atlas)

</div>

Make sense of a codebase you didn't write, check what a change will actually touch before you make it, or walk a new teammate through how a project fits together — **import-atlas** helps with all of that by turning a project's own `import` statements into a report you can click through. It visualizes your application's architecture as it actually is, not as a diagram someone drew once and never updated. Along the way it also surfaces problems a skim of the code misses: exports nothing uses, import cycles, modules pulled in more than once, and — given a layer-rules file — imports that cross an architecture boundary the team didn't mean to allow.

## 🚀 Quickstart

```bash
npx -y import-atlas tree entry_file --root path/to/project --title "my project" --open
```

That's the whole tool for the common case: point it at an entry file, get an interactive HTML report. For every command (`tree`, `graph`, `all`, `scan`), every flag, and how to wire it into `package.json`, see [docs/usage.md](docs/usage.md).

Using a file-system router (Next.js, Nuxt, SvelteKit, Remix)? Pointing the tool at a single layout file only shows what that file imports, not your pages — pass every route file as its own entry instead. See [docs/file-system-routers.md](docs/file-system-routers.md).

Prefer calling it from code instead of the CLI — `scan()`, `buildForest()`/`buildGraph()`, the HTML renderers, or the four Findings detectors on their own? See [docs/library-usage.md](docs/library-usage.md).

## 🔍 What it does

Scan the local import graph of a JavaScript or TypeScript project, starting from one or more entry files, and get it back as an interactive dependency tree or graph in a single HTML file. Runs from the command line and needs no configuration. If the project has a `tsconfig.json`, its `paths` aliases (like `@/*`) are resolved for you.

- Reads every file with the TypeScript parser rather than regular expressions, so it follows `import`, `export ... from`, `import()` and `require()` correctly.
- Resolves relative imports and `tsconfig.json` `paths` aliases the way TypeScript does, `extends` chains included.
- Treats a bare specifier like `react` as an external package: noted on the file that imports it, never followed.
- Draws one tree per entry file. A file used in several places is expanded in one of them; everywhere else it starts small and fills in when you click it.
- Or draws the whole thing as one graph (`import-atlas graph`): every file once, on one canvas, with an edge from each of the places importing it. Shared code is the shape you see rather than something to reconstruct from repeated boxes. `import-atlas all` writes every report from one scan.
- Shows a barrel (index) file's re-exports as its children, narrowed to what the importer asked for. `import { Button } from 'components/button'` shows `Button` alone, not the twenty other components that barrel holds.
- Names each node after the imported name, with the real file name in small text below it and the full path on hover. A node reached by `import { Button } from 'components/button'` reads "Button", even if the file behind it exports that as `default`.
- Finds import cycles. The tree marks one with ⚠ instead of expanding it forever, and the Findings tab lists them loop by loop, shortest first.
- Reads each file's exports as well, and reports what the graph can prove about the code: exports nothing imports, import cycles, and modules pulled in by more than one statement from the same file.
- Colours nodes by "layer" — the first folder under `src/`, or under the project root. A `shared / features / widgets / app` layout reads as colour groups with no setup.
- Checks imports against a layer-rules file — `import-atlas.rules.json` in the project root if it exists, generate a starting point with `import-atlas init-rules` — and flags one crossing a layer boundary the file isn't allowed to reach into.

## 🗺️ The interactive viewer

The generated HTML is one self-contained file with two tabs: the canvas and **Findings**.

Which one depends on the command. `tree` draws a **tree** per entry file, following one path at a time. `graph` draws a single **graph** with every file on it once. They answer different questions and neither replaces the other. Full behavior for each is in [docs/interactive-viewer.md](docs/interactive-viewer.md):

- **[Tree](docs/interactive-viewer.md#tree)** — one collapsible tree per entry file; a file used in several places expands independently wherever you open it, so following a shared file down two pages shows each page's own path.
- **[Graph](docs/interactive-viewer.md#graph)** — the same scan as a single graph, every file drawn once with an edge from each importer, so a widely-shared file's fan-in is a shape you see rather than boxes you count.
- **[Findings](docs/interactive-viewer.md#findings)** — everything the scan can prove about the code: unused exports, import cycles, duplicate imports, and — given a layer-rules file — layer boundary violations, grouped by how sure the graph can be.

## 🔄 Migration guides

Guides for library consumers upgrading across a breaking change, one file per version pair under `docs/migrations/<from>-to-<to>.md`:

- [0.15 → 1.0](docs/migrations/0.15-to-1.0.md) — the `graph` command now draws the graph and the tree moved to `tree`, with the library exports and output filenames renamed to match. The old `graph` command keeps working and writes a different report, so read this one before upgrading.

## 🛠️ Development

See [CONTRIBUTING.md](CONTRIBUTING.md) for how to build the tool from source and how the viewers' client code is organized.

## ⚠️ Known limitations

- Narrowing a barrel to what its importer asked for only works when the request is knowable. A barrel reached by `import * as X`, an `import()`, a `require()`, or forwarded on through an `export * from` shows every one of its re-exports, because nothing in the graph says which of them that reach actually touches.
- JS/TS only. A CSS, SCSS, JSON or asset import still appears as a leaf node, since it resolves to a real file, but it is never parsed for imports of its own.
- `paths` aliases only. A package's own `exports` map is not resolved, which rarely matters since external packages are never followed.
- One HTML file per run. No watch or incremental mode yet.
- In the graph view, a node's column is read from what is on screen, so opening or closing things moves nodes sideways. Position is worth comparing within one picture, not between two.
- The graph view will draw whatever you open, including a node with three hundred importers. Nothing caps that — a fan of three hundred lines is a true answer to "who uses this", but it is not a readable one.
- Framework routing is never drawn as an edge — it is a file-name convention, not an import. See [docs/file-system-routers.md](docs/file-system-routers.md) for how to get full coverage anyway.
- The type-only marking reads declarations, not types, so it under-reports. A `class` used only as a type, or a name reached through `import *` or a dynamic `import()`, stays unmarked — and an unmarked name is one the graph couldn't call a type, not one it calls a value.
