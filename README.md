# import-atlas

Scan a JavaScript/TypeScript project's local import graph from one or more entry files, and render it as an interactive, pannable dependency tree — from the command line, with zero required configuration. If a tsconfig.json is present, its paths aliases (e.g. @/\*) are resolved automatically.

## What it does

- Parses each file's AST (via the TypeScript compiler API — not regex), so it correctly follows `import`, `export ... from`, dynamic `import()` and `require()`.
- Resolves relative imports and `tsconfig.json` `paths` aliases (e.g. `@/*`) the same way TypeScript does, including `extends` chains.
- Treats anything that isn't a local file (bare specifiers like `react`) as an external package: recorded on the importing file, never followed.
- Builds one tree per entry point. A file imported from more than one place keeps a single canonical position — every other place it's imported from becomes a compact, dashed reference node that jumps to the canonical one on click, instead of duplicating its whole subtree.
- Detects import cycles (flagged with ⚠ instead of being expanded forever).
- Colors nodes by "layer" — the first path segment under `src/` (or the project root) — so a `shared < features < widgets < app`-style layout reads as distinct color groups without any project-specific config.

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

or, add script at package.json

```
...
  "script": {
    ...
    "graph": "import-atlas graph path/to/entry.tsx --root . --title "my project" --open"
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

**Fix: pass every route file as its own entry point.** Both `graph` and `scan` accept multiple entries — one tree gets drawn per entry, and any file shared between them collapses into a single node with dashed references (see "What it does" above), so passing many entries doesn't duplicate the shared parts of the app.

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
one canonical node with dashed reference nodes everywhere else it's used, so
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

To work on the tool itself:

```bash
pnpm install
pnpm build      # or `pnpm dev` for an incremental tsc --watch build

# run the CLI straight from source
node dist/cli.js graph path/to/entry.tsx --root path/to/project --open
```

`pnpm link --global` exposes the local build as the `import-atlas` command,
useful for testing it against other projects before publishing.

## Known limitations (v0.1)

- JS/TS only — no CSS/JSON/asset imports.
- `paths` aliases only; package-level `exports` map remapping isn't resolved (external packages are never followed, so this rarely matters).
- One HTML file per run; no incremental/watch mode yet.
- Framework-level routing (Next.js layout/page nesting, Nuxt/SvelteKit/Remix route trees, …) is never shown as an edge — it's file-system convention, not an import. See "Using it with file-system routers" for how to still get full coverage.
