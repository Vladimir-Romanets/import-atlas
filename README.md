# import-atlas

Scan the local import graph of a JavaScript or TypeScript project, starting from one or more entry files, and get it back as an interactive dependency tree in a single HTML file. Runs from the command line and needs no configuration. If the project has a `tsconfig.json`, its `paths` aliases (like `@/*`) are resolved for you.

## What it does

- Reads every file with the TypeScript parser rather than regular expressions, so it follows `import`, `export ... from`, `import()` and `require()` correctly.
- Resolves relative imports and `tsconfig.json` `paths` aliases the way TypeScript does, `extends` chains included.
- Treats a bare specifier like `react` as an external package: noted on the file that imports it, never followed.
- Draws one tree per entry file. A file used in several places is expanded in one of them; everywhere else it starts small and fills in when you click it.
- Shows a barrel (index) file's re-exports as its children, narrowed to what the importer asked for. `import { Button } from 'components/button'` shows `Button` alone, not the twenty other components that barrel holds.
- Names each node after the imported name, with the real file name in small text below it and the full path on hover. A node reached by `import { Button } from 'components/button'` reads "Button", even if the file behind it exports that as `default`.
- Finds import cycles. The tree marks one with ⚠ instead of expanding it forever, and the Findings tab lists every cycle in the graph.
- Reads each file's exports as well, and reports what the graph can prove about the code: exports nothing imports, import cycles, and modules pulled in by more than one statement from the same file.
- Colours nodes by "layer" — the first folder under `src/`, or under the project root. A `shared / features / widgets / app` layout reads as colour groups with no setup.

## The interactive viewer

The generated HTML is one self-contained file with two tabs: **Tree** and **Findings**.

### Tree

Drag to pan, scroll or use the +/− buttons to zoom, click a node to open or close it. "Find a file" in the sidebar jumps to any file by name or path. **Expand all / Collapse** switches between opening everything and the default view, where only the first level or so is open.

A file used in several places is expanded in one of them. Elsewhere it is drawn as a node with no children yet. Click it and it fills in one level, copied from that expansion; its children then behave the same way. So following `Button` down two different pages shows each page's own path, instead of sending you to one shared copy. This is also why "Expand all" never pulls a shared file's whole subtree into every place it is used.

Barrels are the exception: a barrel gets its own expansion for each distinct set of names asked of it, since that is what decides its children.

### Findings

Everything the graph can hold against the code, filterable by name or path. Rows are grouped by what to do about them, so the advice is written once on the group instead of on every row, and each group has a `?` icon that opens a fuller explanation of the rule. Three rules feed the list. Groups are ordered by how sure the graph can be: what it states as fact first, then the two groups that need a second opinion.

**Unused exports** — names nothing in the scan ever imports. Four groups:

- **Unimported exports** — no file in the scan imports the name. Drop the `export` keyword if the symbol is only used inside its own file, or delete the symbol.
- **Unimported re-exports** — a file forwards the name with `export ... from`, but nothing imports it from there. Barrels are where these collect, though any re-exporting file is checked the same way.
- **Named exports duplicating an imported default** — the file exports a symbol both by name and as its default, and only the default is ever imported. The named export is redundant.
- **Names reached through a default object** — the file collects local names into an object and default-exports it (`const Utils = { leftPad }; export default Utils`), and that default is imported. Callers most likely reach the name as `Utils.leftPad`, a property access no import graph can follow. Check these before removing anything.

**Circular imports** — one row per cycle, found over the whole graph rather than per entry file, so it catches loops that no entry's walk order happens to reveal. A row says how many files the cycle spans (or `self-import`, when a file imports itself) and shows one path through it.

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

`graph` is the default command, so `import-atlas entry_file --root . --open` does the same thing. The other command, `scan`, writes the raw graph as JSON for scripts and other tools:

```bash
npx -y import-atlas scan entry_file --root path/to/project --out import-graph.json
```

For repeat use, put it in `package.json`:

```json
"scripts": {
  "graph": "import-atlas graph entry_file --root . --title \"my project\" --open"
}
```

### Options (both commands)

| Flag                       | Default       | Description                                                                                                                         |
| -------------------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `-r, --root <dir>`         | cwd           | Project root. Entry paths are resolved against it (not against cwd), report paths are shown relative to it, and `tsconfig.json` is searched for from it. |
| `-c, --tsconfig <path>`    | auto-detected | Explicit `tsconfig.json` path, if it isn't the nearest one above the root.                                                          |
| `-e, --exclude <regex...>` | none          | Skip files whose root-relative path matches any of these regexes. Accepts multiple values, e.g. `--exclude "\.test\." "__mocks__"`. |
| `--max-files <n>`          | 4000          | Safety cap on how many files a single scan will visit.                                                                              |
| `-o, --out <file>`         | per command   | Where to write the output. `graph` writes HTML, defaulting to `import-graph.html`; `scan` writes JSON, and prints to stdout when the flag is omitted. |

### `graph`-only options

| Flag                  | Default             | Description                                         |
| --------------------- | ------------------- | --------------------------------------------------- |
| `-t, --title <title>` | `Import Graph`      | Page title shown in the sidebar and browser tab.    |
| `--json <file>`       | —                   | Also dump the raw graph as JSON alongside the HTML. |
| `--open`              | off                 | Open the generated HTML in the OS default browser.  |

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
  ...computeFindings(result),        // unimported exports and re-exports
  ...computeCircularImports(result), // import cycles, one row per cycle
  ...computeDupeImports(result),     // one module imported by several statements
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
- Framework routing is never drawn as an edge — it is a file-name convention, not an import. See the section above for how to get full coverage anyway.
