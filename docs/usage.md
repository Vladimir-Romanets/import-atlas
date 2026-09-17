# Usage

A dev-time tool: install it as a `devDependency`, or run it once with `npx`. Needs Node 18 or newer.

`entry_file` below is the file the scan starts from — a `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.mts` or `.cts` file, written relative to `--root` rather than to your shell's current directory.

```bash
# run it once, nothing added to the project
# (-y skips the install prompt npx shows on first run)
npx -y import-atlas tree entry_file --root path/to/project --title "my project" --open

# or install it and drop the npx prefix
pnpm add -D import-atlas
pnpm exec import-atlas tree entry_file --root . --open
```

`tree` is the default command, so `import-atlas entry_file --root . --open` does the same thing.

`graph` renders the same scan as one graph instead of a tree per entry — every file drawn once, with an edge from each importer:

```bash
npx -y import-atlas graph entry_file --root path/to/project --open
```

It writes `import-graph.html`, while `tree` writes `import-tree.html`, so neither overwrites the other and the two can be kept side by side. `dag` is an alias for `graph`.

`all` writes every report from a single scan, which is the expensive half of the work:

```bash
npx -y import-atlas all entry_file --root path/to/project --open
```

Same two filenames as the separate commands, changed with `--out-tree` and `--out-graph`, and one `--title` that each report appends its own kind to — " (tree)" or " (graph)".

`scan` writes the raw graph as JSON for scripts and other tools:

```bash
npx -y import-atlas scan entry_file --root path/to/project --out import-graph.json
```

`init-rules` writes a starter layer-rules file — one entry per layer, each set to `"*"` (may import from anywhere). It reads the directory tree directly rather than scanning entry files, so it needs none, and can't miss a layer that nothing you'd think to pass as an entry happens to import (an unreachable page, a middleware file with its own separate entry point):

```bash
npx -y import-atlas init-rules --root path/to/project
```

It looks in the same two places the layer of a scanned file comes from: every top-level directory under `--root`, plus the children of `src/`. Those are not either/or — a `server/` sitting beside `src/` is its own layer just as much as `src/app` is, and a rules file missing it would silently forbid every import crossing into it. A loose source file at either level is the `(root)` layer.

Two kinds of directory never become a layer. Tooling directories are skipped by name: anything starting with a dot (`.storybook`, `.next`, ...), anything wrapped in double underscores (`__tests__`, `__mocks__`, `__snapshots__`, ...), and `node_modules`, `dist`, `build`, `out`, `coverage`. Everything else has to hold at least one file the scanner can parse (`.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`, `.mjs`, `.cjs`), at any depth — a `docs/` of markdown or a `public/` of images is not a layer, because no scanned file can ever belong to one. A `README.md` or `package.json` at the root doesn't make a `(root)` layer either, for the same reason.

A symlink pointing at a directory is followed and treated as the layer it leads to, since module resolution follows it the same way — a linked package in a monorepo checkout is a layer like any other. Symlink loops are walked once, not forever.

Tighten a layer by replacing its value with an array of the layer names it may import from, or `[]` to forbid all cross-layer imports. `tree`, `graph` and `all` pick up `import-atlas.rules.json` on their own when it sits in `--root` — no flag needed once it exists, the same way a `tsconfig.json` is found without one. They print `Using layer rules from import-atlas.rules.json` when they do, so it's never silent about which policy applied. Use `--rules <file>` only to point at a different file — resolved from your shell's current directory, same as `--tsconfig`/`-o`/`--json`, not from `--root`. The rules file is project policy — commit it, the same as an eslint or tsconfig file — and re-run `init-rules --force` after adding or removing a top-level folder to catch drift (or watch for the warnings the check itself prints when a rule names a layer the scan no longer sees, or a layer has no rule at all).

For repeat use, put it in `package.json`:

```json
"scripts": {
  "graph": "import-atlas tree entry_file --root . --title \"my project\" --open"
}
```

## Options (every command)

| Flag                       | Default              | Description                                                                                                                                                                                                                                                                                                     |
| -------------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `-r, --root <dir>`         | cwd                  | Project root. Entry paths are resolved against it (not against cwd), report paths are shown relative to it, and `tsconfig.json` is searched for from it.                                                                                                                                                        |
| `-c, --tsconfig <path>`    | auto-detected        | Explicit `tsconfig.json` path, if it isn't the nearest one above the root.                                                                                                                                                                                                                                      |
| `-e, --exclude <regex...>` | none                 | Skip files whose root-relative path matches any of these regexes. Accepts multiple values, e.g. `--exclude "\.test\." "__mocks__"`.                                                                                                                                                                             |
| `--max-files <n>`          | 4000, `graph` 10000  | Safety cap on how many files a single scan will visit. Higher for `graph`, which draws a shared file once rather than once per place reaching it, and so stays legible at sizes a tree would not. `all` keeps the tree's 4000, since one scan feeds every report and the tree is the one that gives out first. |
| `-o, --out <file>`         | per command          | Where to write the output. `tree` writes HTML, defaulting to `import-tree.html`, and `graph` to `import-graph.html`; `scan` writes JSON, and prints to stdout when the flag is omitted. `all` writes one file per report, named by `--out-tree` and `--out-graph` instead.                                      |

## `tree`, `graph` and `all` options

| Flag                     | Default                        | Description                                                                                                                 |
| ------------------------ | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `-t, --title <title>`    | `Import Tree` / `Import Graph` | Page title shown in the sidebar and browser tab. `all` takes one title (`Import Atlas`) and appends each report's own kind — " (tree)" or " (graph)". |
| `--max-cycle-length <n>` | 4                              | Longest circular-import loop reported as its own row in the Findings tab.                                                    |
| `--rules <file>`         | `import-atlas.rules.json` in `--root`, if it exists | Layer-rules JSON file (see `init-rules` below); enables the layer-violation check in the Findings tab. An explicit path resolves from cwd, like `--tsconfig`/`-o`/`--json` — only the default filename is looked up under `--root`. Nothing happens if the default file isn't there and the flag isn't passed. |
| `--json <file>`          | —                              | Also dump the raw graph as JSON alongside the HTML.                                                                          |
| `--open`                 | off                            | Open the generated HTML in the OS default browser.                                                                           |

## `init-rules` options

| Flag              | Default                    | Description                                                                 |
| ------------------ | --------------------------- | ---------------------------------------------------------------------------- |
| `-r, --root <dir>` | cwd                         | Project root; layers are read from its top-level directories plus the children of `src/`. |
| `-o, --out <file>` | `import-atlas.rules.json`  | Where to write the rules file, relative to `--root`.                        |
| `--force`          | off                         | Overwrite the output file if it already exists. Without it, an existing file is left untouched. |

No entry files, `--tsconfig`, `--exclude` or `--max-files` — those matter to a scan, and `init-rules` doesn't run one.
