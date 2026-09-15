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

Scan the local import graph of a JavaScript or TypeScript project, starting from one or more entry files, and get it back as an interactive dependency tree in a single HTML file. Runs from the command line and needs no configuration. If the project has a `tsconfig.json`, its `paths` aliases (like `@/*`) are resolved for you.

## What it does

- Reads every file with the TypeScript parser rather than regular expressions, so it follows `import`, `export ... from`, `import()` and `require()` correctly.
- Resolves relative imports and `tsconfig.json` `paths` aliases the way TypeScript does, `extends` chains included.
- Treats a bare specifier like `react` as an external package: noted on the file that imports it, never followed.
- Draws one tree per entry file. A file used in several places is expanded in one of them; everywhere else it starts small and fills in when you click it.
- Or draws the whole thing merged (`import-atlas merged`): every file once, on one canvas, with an edge from each of the places importing it. Shared code is the shape you see rather than something to reconstruct from repeated boxes. `import-atlas all` writes every report from one scan.
- Shows a barrel (index) file's re-exports as its children, narrowed to what the importer asked for. `import { Button } from 'components/button'` shows `Button` alone, not the twenty other components that barrel holds.
- Names each node after the imported name, with the real file name in small text below it and the full path on hover. A node reached by `import { Button } from 'components/button'` reads "Button", even if the file behind it exports that as `default`.
- Finds import cycles. The tree marks one with ⚠ instead of expanding it forever, and the Findings tab lists them loop by loop, shortest first.
- Reads each file's exports as well, and reports what the graph can prove about the code: exports nothing imports, import cycles, and modules pulled in by more than one statement from the same file.
- Colours nodes by "layer" — the first folder under `src/`, or under the project root. A `shared / features / widgets / app` layout reads as colour groups with no setup.

## The interactive viewer

The generated HTML is one self-contained file with two tabs: the graph and **Findings**.

Which graph depends on the command. `graph` draws a **tree** per entry file, following one path at a time. `merged` draws a single **graph** with every file on it once. They answer different questions and neither replaces the other — see below.

### Tree

Drag to pan, scroll or use the +/− buttons to zoom, click a node to open or close it. "Find a file" in the sidebar jumps to any file by name or path. **Expand / Collapse** switches between opening everything already loaded and the default view, where only the first level or so is open.

A file used in several places is expanded in one of them. Elsewhere it is drawn as a node with no children yet. Click it and it fills in one level, copied from that expansion; its children then behave the same way. So following `Button` down two different pages shows each page's own path, instead of sending you to one shared copy. This is also why "Expand" never pulls a shared file's whole subtree into every place it is used.

Barrels are the exception: a barrel gets its own expansion for each distinct set of names asked of it, since that is what decides its children.

A link taken only lazily — a dynamic `import()`, or a `require` inside a function — is drawn dotted, as in the merged view. A pair linked by both a lazy statement and a plain one is drawn solid: the file loads eagerly regardless.

### Merged graph

Written by `import-atlas merged`, as a separate report. Every file is one node, however many places import it, and every importer gets an edge to it. So the thing a tree has to repeat — the barrel that twelve features use, the helper half the app imports — is drawn once here, with the twelve lines arriving at it. That convergence is the picture.

A node has a control on each side:

- the **chevron on the right** opens what the file imports, as in the tree;
- the **number on the left** is how many files import it, and clicking that opens them. It appears only where some of those importers aren't on screen yet: a file you opened from above is already showing the one that led you there, and so is a barrel whose importers are all drawn.

Clicking a node you have already clicked — one that is selected with nothing left to open — walks one step backwards, to the nearest file importing it; click again and again to follow a file's way back to the entry point. With several importers on screen the nearest one wins, since there is no other way to choose between them. A file the search landed on is not walked away from: it is selected on arrival, but the click that follows is still about the file itself.

The badge is what a tree cannot do from the node itself: it walks the graph backwards. Searching for a file does it for you — land on `shared/api` and its importers are already drawn, since "who uses this" is usually why you went looking.

Selecting a node dims everything it doesn't touch and lights up both directions at once: what imports it, what it imports, and — one hop further — which of a barrel's re-exports that selection actually reaches. That last part is how this view keeps what the tree gets structurally. The tree can give a barrel a separate expansion per set of names asked of it; a merged node serves every importer at once, so the same information is carried by emphasis instead. The barrel keeps all twenty children on screen, and selecting an importer lights the two it uses.

Cycle-closing edges are drawn dashed and red, right to left; lazy or dynamic imports are dotted. Columns are the distance from whatever is furthest upstream **among the nodes currently on screen**, so opening and closing things does move nodes sideways — the alternative is measuring against the whole project, which parks a widely-shared barrel hundreds of columns to the right of the entry point that also imports it directly.

Only what fits on screen is drawn, so a few thousand files stay responsive; zoomed far out, nodes become plain blocks of their layer's colour, since an 11px label is unreadable there anyway.

### Findings

Everything the graph can hold against the code, filterable by name or path. Rows are grouped by what to do about them, so the advice is written once on the group instead of on every row, and each group has a `?` icon that opens a fuller explanation of the rule. Three rules feed the list. Groups are ordered by how sure the graph can be: what it states as fact first, then the two groups that need a second opinion.

**Unused exports** — names nothing in the scan ever imports. Four groups:

- **Unimported exports** — no file in the scan imports the name. Drop the `export` keyword if the symbol is only used inside its own file, or delete the symbol.
- **Unimported re-exports** — a file forwards the name with `export ... from`, but nothing imports it from there. Barrels are where these collect, though any re-exporting file is checked the same way.
- **Named exports duplicating an imported default** — the file exports a symbol both by name and as its default, and only the default is ever imported. The named export is redundant.
- **Names reached through a default object** — the file collects local names into an object and default-exports it (`const Utils = { leftPad }; export default Utils`), and that default is imported. Callers most likely reach the name as `Utils.leftPad`, a property access no import graph can follow. Check these before removing anything.

**Circular imports** — one row per loop, found over the whole graph rather than per entry file, so it catches loops that no entry's walk order happens to reveal. A row shows the chain of imports that closes back on itself, and counts the files on that chain — the count always matches the names beside it. Tightest loops come first, since a pair of files importing each other is the easiest kind to separate.

Files often tangle into a group where everyone reaches everyone, and such a group holds many loops. Each one gets its own row, so a fix has a row to belong to; the hover text says how big the group is and how many loops were found in it. Only loops of four files or fewer are listed — longer ones are usually two shorter loops chained together. Raise that with `--max-cycle-length`, or drop it to `2` to see only mutual imports.

Only imports that run while a module is loading count. An import written inside a function — `lazy(() => import('./Page'))`, a `require()` in a branch — runs when that function is called, long after every module has loaded, so a loop closing only through one of those is not reported. A `require()` or `await import()` at the top level is counted: those run during loading, like a plain `import`.

**Duplicate imports** — one row per file-and-module pair linked by more than one statement: a value import plus a separate type-only import, two re-export lines, or the same path written twice. Imports inside functions are left out here too, since a lazy `import()` next to a static one is not a line you could merge without undoing the code splitting.

The unused-export rules skip a file completely when the graph cannot speak for it: an entry file (nothing inside the scan imports it, so its exports serve whatever lies outside), a file pulled in wholesale with `import * as X`, an `import()`, a `require()` or an `export * from`, a file using `export =`, and any file that would not parse. The cycle and duplicate rules read the import edges instead of the exports, so they need no such exemption — an entry file can and does show up in those two groups.

The list still runs when the scan reports coverage gaps — the `--max-files` cap fired, a file would not parse, a path would not resolve — and says so above the results, because a file the walk never read could be the one importing a name below. Two gaps cannot be detected at all: a consumer outside every entry file's reach, and one you dropped yourself with `--exclude`. Read "unimported" as "unimported within what was scanned", and widen your entry files before deleting in bulk.

## Usage

A dev-time tool: install it as a `devDependency`, or run it once with `npx`. Needs Node 18 or newer.

`entry_file` below is the file the scan starts from — a `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.mts` or `.cts` file, written relative to `--root` rather than to your shell's current directory.

```bash
# run it once, nothing added to the project
# (-y skips the install prompt npx shows on first run)
npx -y import-atlas graph entry_file --root path/to/project --title "my project" --open

# or install it and drop the npx prefix
pnpm add -D import-atlas
pnpm exec import-atlas graph entry_file --root . --open
```

`graph` is the default command, so `import-atlas entry_file --root . --open` does the same thing.

`merged` renders the same scan as one graph instead of a tree per entry — every file drawn once, with an edge from each importer:

```bash
npx -y import-atlas merged entry_file --root path/to/project --open
```

It writes `import-graph-merged.html`, so it does not overwrite a report from `graph`, and the two can be kept side by side. `dag` is an alias for it.

`all` writes every report from a single scan, which is the expensive half of the work:

```bash
npx -y import-atlas all entry_file --root path/to/project --open
```

Same two filenames as the separate commands, changed with `--out-tree` and `--out-merged`, and one `--title` that the merged report appends " (merged)" to.

The remaining command, `scan`, writes the raw graph as JSON for scripts and other tools:

```bash
npx -y import-atlas scan entry_file --root path/to/project --out import-graph.json
```

For repeat use, put it in `package.json`:

```json
"scripts": {
  "graph": "import-atlas graph entry_file --root . --title \"my project\" --open"
}
```

### Options (every command)

| Flag                       | Default              | Description                                                                                                                                                                                                                                                                                                     |
| -------------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `-r, --root <dir>`         | cwd                  | Project root. Entry paths are resolved against it (not against cwd), report paths are shown relative to it, and `tsconfig.json` is searched for from it.                                                                                                                                                        |
| `-c, --tsconfig <path>`    | auto-detected        | Explicit `tsconfig.json` path, if it isn't the nearest one above the root.                                                                                                                                                                                                                                      |
| `-e, --exclude <regex...>` | none                 | Skip files whose root-relative path matches any of these regexes. Accepts multiple values, e.g. `--exclude "\.test\." "__mocks__"`.                                                                                                                                                                             |
| `--max-files <n>`          | 4000, `merged` 10000 | Safety cap on how many files a single scan will visit. Higher for `merged`, which draws a shared file once rather than once per place reaching it, and so stays legible at sizes a tree would not. `all` keeps the tree's 4000, since one scan feeds every report and the tree is the one that gives out first. |
| `-o, --out <file>`         | per command          | Where to write the output. `graph` writes HTML, defaulting to `import-graph.html`, and `merged` to `import-graph-merged.html`; `scan` writes JSON, and prints to stdout when the flag is omitted. `all` writes one file per report, named by `--out-tree` and `--out-merged` instead.                           |

### `graph`, `merged` and `all` options

| Flag                     | Default                                  | Description                                                                                                            |
| ------------------------ | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `-t, --title <title>`    | `Import Graph` / `Import Graph (merged)` | Page title shown in the sidebar and browser tab. `all` takes one title and appends " (merged)" to the merged report's. |
| `--max-cycle-length <n>` | 4                                        | Longest circular-import loop reported as its own row in the Findings tab.                                              |
| `--json <file>`          | —                                        | Also dump the raw graph as JSON alongside the HTML.                                                                    |
| `--open`                 | off                                      | Open the generated HTML in the OS default browser.                                                                     |

## Using it with file-system routers (Next.js, Nuxt, SvelteKit, Remix…)

import-atlas follows real `import` / `require` / `export ... from` statements and nothing else. It has no idea that a file is a page. Frameworks that route by file name load most of the app themselves: nothing ever imports `app/page.tsx` or `pages/about.tsx`, the router does. Point the tool at `app/layout.tsx` alone and you see what that one file imports — a couple of providers and `globals.css` — and nothing else.

The fix is to pass every route file as its own entry. Both commands accept many entries, and a file shared between them is still expanded only once, so a long entry list does not duplicate the app. Typing that list by hand does not scale, so generate it:

```bash
import-atlas graph $(find src/app -name "page.tsx" -o -name "layout.tsx") \
  --root . --open
```

Quote any path holding a `(route-group)` or `[param]` segment — parentheses and brackets mean something to the shell.

You get one tree per route file. Nothing joins a layout to the pages it wraps, because that nesting is the router's doing rather than an import. What crosses between the trees is the shared code: a component, a fetch helper, a store used by several routes is drawn once and opens wherever you click it.

For other frameworks, swap the `find` target: Next.js Pages Router (`find src/pages -name "*.tsx" ! -path "*/api/*"` — API routes are rarely worth graphing as UI dependencies), Nuxt (`pages/`), SvelteKit (`src/routes/`), Remix (`app/routes/`).

## Using it as a library

```ts
import { scan, buildForest, renderHtml } from "import-atlas";

// pass every route/page you want covered — with a file-system router
// that means more than just the root layout, see the section above
const result = scan(["src/index.ts"], { root: process.cwd() });
const forest = buildForest(result);
const html = renderHtml(forest, result, { title: "My app" });
```

`scan()` returns the whole graph (`nodes`, `edges`, per-node fan-in) and `buildForest()` turns it into the tree the HTML renderer expects. Either is useful on its own if you want your own report format.

The merged report is the same scan through a different pair:

```ts
import { scan, buildGraph, renderGraphHtml } from "import-atlas";

const result = scan(["src/index.ts"], { root: process.cwd() });
const graph = buildGraph(result); // one node per file, one edge per pair
const html = renderGraphHtml(graph, result, { title: "My app" });
```

`buildGraph()` is worth having on its own: it collapses the repeated statements between a pair of files into one edge, counts how many files import each file, works out how far each sits from an entry point, and marks the edges that close cycles — all of it plain data, and none of it needing the viewer.

The Findings tab is three separate detectors over one `scan()` result. Each returns a `Finding[]` and each works alone:

```ts
import {
  computeFindings,
  computeCircularImports,
  computeDupeImports,
  sortFindings,
} from "import-atlas";

// exactly what renderHtml() puts in the Findings tab, in the same order
const findings = sortFindings([
  ...computeFindings(result), // unimported exports and re-exports
  ...computeCircularImports(result), // import cycles, one row per loop
  // takes { maxCycleLength } — default 4
  ...computeDupeImports(result), // one module imported by several statements
]);
```

`sortFindings()` is what puts the merged list in most-trustworthy-first order; inside one confidence level each detector keeps its own row order. Drop it if you only want one detector, or want to order the rows yourself.

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md) for how to build the tool from source and how the graph viewer's client code is organized.

## Known limitations

- Narrowing a barrel to what its importer asked for only works when the request is knowable. A barrel reached by `import * as X`, an `import()`, a `require()`, or forwarded on through an `export * from` shows every one of its re-exports, because nothing in the graph says which of them that reach actually touches.
- JS/TS only. A CSS, SCSS, JSON or asset import still appears as a leaf node, since it resolves to a real file, but it is never parsed for imports of its own.
- `paths` aliases only. A package's own `exports` map is not resolved, which rarely matters since external packages are never followed.
- One HTML file per run. No watch or incremental mode yet.
- In the merged view, a node's column is read from what is on screen, so opening or closing things moves nodes sideways. Position is worth comparing within one picture, not between two.
- The merged view will draw whatever you open, including a node with three hundred importers. Nothing caps that — a fan of three hundred lines is a true answer to "who uses this", but it is not a readable one.
- Framework routing is never drawn as an edge — it is a file-name convention, not an import. See the section above for how to get full coverage anyway.
