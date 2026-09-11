# import-atlas

Scan a JavaScript/TypeScript project's local import graph from one or more entry files, and render it as an interactive, pannable dependency tree — from the command line, with zero required configuration. If a tsconfig.json is present, its paths aliases (e.g. @/\*) are resolved automatically.

## What it does

- Parses each file's AST (via the TypeScript compiler API — not regex), so it correctly follows `import`, `export ... from`, dynamic `import()` and `require()`.
- Resolves relative imports and `tsconfig.json` `paths` aliases (e.g. `@/*`) the same way TypeScript does, including `extends` chains.
- Treats anything that isn't a local file (bare specifiers like `react`) as an external package: recorded on the importing file, never followed.
- Builds one tree per entry point. A file imported from more than one place keeps a single canonical position — every other place it's imported from starts out as a compact node holding no children, rather than duplicating the whole subtree up front. It is a full node all the same: open it and it fills in from that one expansion, a level per click, so a shared file's imports can be followed along the path you're actually reading. A barrel is the one exception to sharing an expansion: it gets one per distinct set of names asked of it, since that's what decides its children.
- Shows a barrel/index file's re-exports as its children, narrowed to what the importer actually asked for — `import { Button } from 'components/button'` shows `Button` alone, not the twenty other components that barrel also re-exports. A file importing `IconButton` from the same barrel gets its own node showing that instead, so each node describes the path you're following rather than the barrel file's full contents.
- Labels each node by the actual imported name — e.g. a node reached via `import { Button } from 'components/button'` is labeled "Button", even if that resolves through a barrel to a file that internally exports it as `default` — with the underlying file's own name shown in small text underneath, and the full path on hover.
- Detects import cycles (flagged with ⚠ instead of being expanded forever).
- Reads each file's own exports as well as its imports, and lists every export nothing in the scan ever asks for — see the Findings tab below.
- Colors nodes by "layer" — the first path segment under `src/` (or the project root) — so a `shared < features < widgets < app`-style layout reads as distinct color groups without any project-specific config.

## The interactive viewer

The generated HTML is a single self-contained file with two tabs: **Tree** and **Findings**.

### Tree

Drag to pan, scroll (or the +/− buttons) to zoom, click a node to expand or collapse it, and use "Find a file" in the sidebar to jump straight to any file by name or path. The "View" section carries one toggle:

- **Expand all / Collapse** — flips between fully expanding every node and the default view (only the first level or so open). It opens what the tree already holds; a re-used node is filled in only when you open it, so this never pulls a shared file's whole subtree into every place it's used.

A node for a file that is expanded elsewhere opens where it stands, filling in one level from that expansion — and its own children behave the same way, so the next click goes a level deeper. Following `Button` down two different pages therefore shows each page's own path, rather than sending you off to a single shared copy. Which occurrence holds the expansion the others copy from is an implementation detail of the payload, and the viewer draws them all alike.

### Findings

Every export nothing in the scanned graph asks for, filterable by name or path and grouped by what to do about it — the advice sits on the group, so it's stated once rather than repeated on every row. Groups are ordered by how much the import graph alone can justify the claim:

- **Unimported exports** — no file in the scan imports the name. Drop the `export` keyword if the symbol is only used inside its own file, or remove the symbol entirely.
- **Unimported barrel re-exports** — a barrel forwards the name with `export ... from`, but nothing imports it from there.
- **Named exports duplicating an imported default** — the file exports a symbol both by name and as its default, and only the default is ever imported, so the named export is redundant.
- **Names reached through a default object** — the file gathers local bindings into an object it default-exports (`const Utils = { leftPad }; export default Utils`) and that default IS imported. Consumers most likely reach the name as `Utils.leftPad`, a property access no import graph can follow, so treat these as "check before removing", not as dead code.

A file is skipped entirely — nothing in it is ever listed — when the graph can't speak for it: an entry point (nothing inside the scan imports an entry, so its exports serve whatever lies outside it), a file some importer pulled wholesale with `import * as X`, a dynamic `import()`, a `require()` or an `export * from`, a file using `export =`, and any file that wouldn't parse.

The list still runs when the scan reports coverage gaps — the `--max-files` cap fired, a file wouldn't parse, a specifier wouldn't resolve — but says so above the results, since a file the walk never read could be the one importing a name below. Two gaps can't be detected at all: a consumer that sits outside every entry point's reach, and one you dropped yourself with `--exclude`. Both are invisible to the scan, so read "unimported" as "unimported within what was scanned", and widen your entry points before acting in bulk.

## Usage

This is a dev-time tool — install it as a `devDependency`, or just run it one-off with `npx`:

```bash
# one-off, no install
npx import-atlas graph path/to/entry.tsx \
  --root path/to/project \
  --title "my project" \
  --open

# same scan, but just the raw graph as JSON (for scripting / other tooling)
npx import-atlas scan path/to/entry.tsx \
  --root path/to/project \
  --out import-graph.json
```

`graph` is the default command, so you can also drop it:

```bash
npx import-atlas path/to/entry.tsx --root path/to/project --open
```

Or install it once and drop the `npx` prefix:

```bash
pnpm add -D import-atlas

pnpm exec import-atlas graph path/to/entry.tsx \
  --root path/to/project \
  --title "my project" \
  --open
```

or, add scripts at package.json

```
...
  "scripts": {
    ...
    "graph": "import-atlas graph path/to/entry.tsx --root . --title \"my project\" --open"
  }
```

### Options (both commands)

| Flag                       | Default       | Description                                                                                                                         |
| -------------------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `-r, --root <dir>`         | cwd           | Project root — where relative paths are computed from and where `tsconfig.json` is searched for.                                    |
| `-c, --tsconfig <path>`    | auto-detected | Explicit `tsconfig.json` path, if it isn't the nearest one above the root.                                                          |
| `-e, --exclude <regex...>` | none          | Skip files whose root-relative path matches any of these regexes. Accepts multiple values, e.g. `--exclude "\.test\." "__mocks__"`. |
| `--max-files <n>`          | 4000          | Safety cap on how many files a single scan will visit.                                                                              |

### `graph`-only options

| Flag                  | Default             | Description                                         |
| --------------------- | ------------------- | --------------------------------------------------- |
| `-o, --out <file>`    | `import-graph.html` | Output HTML path.                                   |
| `-t, --title <title>` | `Import Graph`      | Page title shown in the sidebar and browser tab.    |
| `--json <file>`       | —                   | Also dump the raw graph as JSON alongside the HTML. |
| `--open`              | off                 | Open the generated HTML in the OS default browser.  |

## Using it with file-system routers (Next.js, Nuxt, SvelteKit, Remix…)

**import-atlas** only follows literal `import` / `require` / `export ... from` statements — it has no notion of "this file is a page" unless something actually imports it. Frameworks that route by file-system convention (Next.js App Router and Pages Router, Nuxt, SvelteKit, Remix, Astro, …) load most of the app that way: nothing ever `import`s `app/page.tsx` or `pages/about.tsx`, the framework's own router does. Point import-atlas at a single root file — say, a Next.js `app/layout.tsx` — and you'll only see what that file itself imports (typically a couple of providers and `globals.css`), not the rest of the application.

**Fix: pass every route file as its own entry point.** Both `graph` and `scan` accept multiple entries — one tree gets drawn per entry, and any file shared between them is expanded once and opened on demand elsewhere (see "What it does" above), so passing many entries doesn't duplicate the shared parts of the app up front.

### Worked example: a small Next.js App Router project

Say your `src/app/` looks like this:

```
src/app/
├── layout.tsx                  # root layout — mounts providers
├── page.tsx                    # "/"
├── globals.css
├── (auth)/
│   ├── layout.tsx              # centers the auth card
│   ├── login/page.tsx          # "/login"
│   └── register/page.tsx       # "/register"
└── (dashboard)/
    ├── layout.tsx              # sidebar + header shell
    ├── overview/page.tsx       # "/overview"
    └── settings/page.tsx       # "/settings"
```

Every `layout.tsx` _and_ `page.tsx` is a separate entry point — a nested
layout isn't imported by the pages it wraps any more than the root layout
is, it's the router that nests them:

```bash
import-atlas graph \
  src/app/layout.tsx \
  src/app/page.tsx \
  "src/app/(auth)/layout.tsx" \
  "src/app/(auth)/login/page.tsx" \
  "src/app/(auth)/register/page.tsx" \
  "src/app/(dashboard)/layout.tsx" \
  "src/app/(dashboard)/overview/page.tsx" \
  "src/app/(dashboard)/settings/page.tsx" \
  --root . --open
```

(Quote any path with a `(route-group)` or `[param]` segment — parentheses
and brackets are shell-special.)

This draws 8 separate trees, one per entry, each showing what that file
_actually_ imports (a `Button` from `shared/ui`, a `getSession()` helper, …).
Nothing connects `(dashboard)/layout.tsx` to `overview/page.tsx` — that
nesting is the router's doing, not an import, so it's not part of the graph.
What you do get for free: anything imported from more than one of those 8
files — a shared component, a fetch helper, a Zustand store — collapses into
one full expansion, opened on demand everywhere else it is used, so
the cross-cutting shared code still reads as a single coherent map even
though the 8 route trees themselves are independent.

Typing every route by hand doesn't scale past a handful of pages, so
generate the entry list instead — for the tree above:

```bash
import-atlas graph $(find src/app -name "page.tsx" -o -name "layout.tsx") \
  --root . --open
```

The same idea applies to other file-based routers — swap the `find` target for the framework's routes directory: Next.js Pages Router (`find src/pages -name "*.tsx" ! -path "*/api/*"` — API routes usually aren't worth graphing as UI dependencies), Nuxt (`pages/`), SvelteKit (`src/routes/`), Remix (`app/routes/`), and so on.

## Using it as a library

```ts
import { scan, buildForest, renderHtml } from "import-atlas";

// pass every route/page you want covered — for a file-system router
// (Next.js, Nuxt, SvelteKit, ...) that means more than just the root layout,
// see "Using it with file-system routers" above
const result = scan(["src/index.ts"], { root: process.cwd() });
const forest = buildForest(result);
const html = renderHtml(forest, result, { title: "My app" });
```

`scan()` returns the full graph (`nodes`, `edges`, per-node fan-in);
`buildForest()` turns it into the tree structure the HTML renderer expects.
Both are independently useful if you want your own report format.

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md) for how to build the tool from
source and how the graph viewer's client code is organized.

## Known limitations

- Narrowing a barrel to what its importer asked for needs the request to be knowable. A barrel reached by a namespace import (`import * as X`), a dynamic `import()`, a `require()`, or forwarded on through an `export * from` shows every one of its re-exports, since nothing in the graph says which of them that reach actually touches.
- JS/TS only — a CSS/SCSS/JSON/asset import (e.g. `./main.scss`) still shows up as a leaf node in the tree since it resolves to a real file on disk, it's just never parsed further for its own imports.
- `paths` aliases only; package-level `exports` map remapping isn't resolved (external packages are never followed, so this rarely matters).
- One HTML file per run; no incremental/watch mode yet.
- Framework-level routing (Next.js layout/page nesting, Nuxt/SvelteKit/Remix route trees, …) is never shown as an edge — it's file-system convention, not an import. See "Using it with file-system routers" for how to still get full coverage.
