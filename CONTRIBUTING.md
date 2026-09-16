# Developing import-atlas

To work on the tool itself:

```bash
pnpm install
pnpm build      # or `pnpm dev` for an incremental tsc --watch build

# run the CLI straight from source
node dist/cli.js tree path/to/entry.tsx --root path/to/project --open
```

`pnpm link --global` exposes the local build as the `import-atlas` command,
useful for testing it against other projects before publishing.

## Where things live

```
src/
  cli.ts        the command
  index.ts      the public API — the only thing consumers import
  types.ts      the vocabulary every folder below shares
  engine/       files in, graph and verdicts out; knows nothing about HTML
  report/       Node side: turns a scan into one self-contained HTML file
  render/       browser side: the viewers' own code, CSS and HTML
  utils/        small pure helpers with no dependencies of their own
```

`report/` and `render/` are the pair worth keeping straight: everything in
`report/` runs in Node and assembles the file, everything in `render/` runs
in the reader's browser once it is opened.

## The viewers' client code

The interactive HTML report is a single self-contained file (openable via
`file://`, no server needed), so its client-side code can't be loaded as
separate `<script type="module">` files at runtime. Instead it's authored
as normal TypeScript under `src/render/`:

There are two viewers — the tree written by `tree`, and the graph written
by `graph` — bundled separately so neither report carries the other's
code:

- `src/render/render.html` — the markup both viewers render from: sidebar,
  tabs, canvas and Findings panel. The few spots that differ are
  `{{placeholders}}`, filled by `VARIANTS` in
  `scripts/generate-render-assets.js`; the prose for each viewer's sidebar
  hint lives in `render.tree.hint.html` / `render.graph.hint.html`. Add a
  placeholder only where the two viewers genuinely can't share markup —
  everything else belongs in the skeleton itself.
- `src/render/render.tree.css` — plain CSS for the tree written by `tree`.
- `src/render/render.graph.css` — the graph viewer's, written by `graph`;
  it extends `render.tree.css` rather than restating it (the build emits
  the two concatenated).
- `src/render/render.tree.client.ts` and the modules it imports from
  `src/render/client/*.ts` — the tree viewer's logic (layout, pan/zoom,
  search, etc.), type-checked against `tsconfig.browser.json` (which adds
  DOM types, since this code runs in a browser, not Node).
- `src/render/render.graph.client.ts` with `src/render/client/graph/*.ts` —
  the graph viewer: what is visible, the DAG layout, highlighting, and a
  renderer that draws only what is on screen. The sidebar, colours,
  viewport, search, tabs and Findings modules are shared with the tree.

`pnpm build` / `pnpm dev` / `pnpm typecheck` all run
`scripts/generate-render-assets.js` first, which bundles and minifies the
client TypeScript with esbuild and inlines it — together with the CSS/HTML
— into `src/report/render.generated.ts` (a generated file, not committed
to git). `report/render.tree.ts` imports its
`CSS_TREE`/`BODY_TREE`/`SCRIPT_TREE` constants from there, and
`report/render.graph.ts` the `CSS_GRAPH`/`BODY_GRAPH`/`SCRIPT_GRAPH`
ones.

On a fresh clone, your editor's TypeScript server may report a missing
`./render.generated` module until you run one of those commands once. Use
`pnpm typecheck:client` to type-check just the client code without
touching the rest of the build.
