# Developing import-atlas

To work on the tool itself:

```bash
pnpm install
pnpm build      # or `pnpm dev` for an incremental tsc --watch build

# run the CLI straight from source
node dist/cli.js graph path/to/entry.tsx --root path/to/project --open
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

## The graph viewer's client code

The interactive HTML report is a single self-contained file (openable via
`file://`, no server needed), so its client-side code can't be loaded as
separate `<script type="module">` files at runtime. Instead it's authored
as normal TypeScript under `src/render/`:

There are two viewers — the tree written by `graph`, and the merged graph
written by `merged` — bundled separately so neither report carries the
other's code:

- `src/render/render.css`, `render.html` — plain CSS/HTML for the tree.
- `src/render/render.graph.css`, `render.graph.html` — the merged viewer's,
  the CSS extending `render.css` rather than restating it (the build emits
  the two concatenated).
- `src/render/render.client.ts` and the modules it imports from
  `src/render/client/*.ts` — the tree viewer's logic (layout, pan/zoom,
  search, etc.), type-checked against `tsconfig.browser.json` (which adds
  DOM types, since this code runs in a browser, not Node).
- `src/render/render.graph.client.ts` with `src/render/client/graph/*.ts` —
  the merged viewer: what is visible, the DAG layout, highlighting, and a
  renderer that draws only what is on screen. The sidebar, colours,
  viewport, search and Findings modules are shared with the tree.

`pnpm build` / `pnpm dev` / `pnpm typecheck` all run
`scripts/generate-render-assets.js` first, which bundles and minifies the
client TypeScript with esbuild and inlines it — together with the CSS/HTML
— into `src/report/render.generated.ts` (a generated file, not committed
to git). `report/render.ts` imports its `CSS`/`BODY`/`SCRIPT` constants from
there, and `report/renderGraph.ts` the `CSS_GRAPH`/`BODY_GRAPH`/`SCRIPT_GRAPH`
ones.

On a fresh clone, your editor's TypeScript server may report a missing
`./render.generated` module until you run one of those commands once. Use
`pnpm typecheck:client` to type-check just the client code without
touching the rest of the build.
