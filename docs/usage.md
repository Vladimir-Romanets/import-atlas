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

The remaining command, `scan`, writes the raw graph as JSON for scripts and other tools:

```bash
npx -y import-atlas scan entry_file --root path/to/project --out import-graph.json
```

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
| `--json <file>`          | —                              | Also dump the raw graph as JSON alongside the HTML.                                                                          |
| `--open`                 | off                            | Open the generated HTML in the OS default browser.                                                                           |
