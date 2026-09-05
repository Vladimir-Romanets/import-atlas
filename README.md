# import-atlas

Scan a JavaScript/TypeScript project's local import graph from one or more
entry files, and render it as an interactive, pannable dependency tree —
from the command line, no config beyond an existing `tsconfig.json`.

## What it does

- Parses each file's AST (via the TypeScript compiler API — not regex), so
  it correctly follows `import`, `export ... from`, dynamic `import()` and
  `require()`.
- Resolves relative imports and `tsconfig.json` `paths` aliases (e.g. `@/*`)
  the same way TypeScript does, including `extends` chains.
- Treats anything that isn't a local file (bare specifiers like `react`) as
  an external package: recorded on the importing file, never followed.
- Builds one tree per entry point. A file imported from more than one place
  keeps a single canonical position — every other place it's imported from
  becomes a compact, dashed reference node that jumps to the canonical one
  on click, instead of duplicating its whole subtree.
- Detects import cycles (flagged with ⚠ instead of being expanded forever).
- Colors nodes by "layer" — the first path segment under `src/` (or the
  project root) — so a `shared < features < widgets < app`-style layout
  reads as distinct color groups without any project-specific config.

## Usage

This is a dev-time tool — install it as a `devDependency`, or just run it
one-off with `npx`:

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

Or install it once and drop the `npx` prefix:

```bash
pnpm add -D import-atlas
```

### Options (both commands)

| Flag | Default | Description |
|---|---|---|
| `-r, --root <dir>` | cwd | Project root — where relative paths are computed from and where `tsconfig.json` is searched for. |
| `-c, --tsconfig <path>` | auto-detected | Explicit `tsconfig.json` path, if it isn't the nearest one above the root. |
| `-e, --exclude <regex...>` | none | Skip files whose root-relative path matches any of these regexes. |
| `--max-files <n>` | 4000 | Safety cap on how many files a single scan will visit. |

### `graph`-only options

| Flag | Default | Description |
|---|---|---|
| `-o, --out <file>` | `import-graph.html` | Output HTML path. |
| `-t, --title <title>` | `Import Graph` | Page title shown in the sidebar and browser tab. |
| `--json <file>` | — | Also dump the raw graph as JSON alongside the HTML. |
| `--open` | off | Open the generated HTML in the OS default browser. |

## Using it as a library

```ts
import { scan, buildForest, renderHtml } from 'import-atlas';

const result = scan(['src/app/layout.tsx'], { root: process.cwd() });
const forest = buildForest(result);
const html = renderHtml(forest, result, { title: 'My app' });
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
- `paths` aliases only; package-level `exports` map remapping isn't
  resolved (external packages are never followed, so this rarely matters).
- One HTML file per run; no incremental/watch mode yet.
