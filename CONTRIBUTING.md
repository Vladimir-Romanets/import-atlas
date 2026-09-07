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

## The graph viewer's client code

The interactive HTML report is a single self-contained file (openable via
`file://`, no server needed), so its client-side code can't be loaded as
separate `<script type="module">` files at runtime. Instead it's authored
as normal TypeScript under `src/render/`:

- `src/render/render.css`, `render.html` — plain CSS/HTML.
- `src/render/render.client.ts` and the modules it imports from
  `src/render/client/*.ts` — the viewer's logic (layout, pan/zoom, search,
  etc.), type-checked against `tsconfig.browser.json` (which adds DOM
  types, since this code runs in a browser, not Node).

`pnpm build` / `pnpm dev` / `pnpm typecheck` all run
`scripts/generate-render-assets.js` first, which bundles and minifies the
client TypeScript with esbuild and inlines it — together with the CSS/HTML
— into `src/render.generated.ts` (a generated file, not committed to git).
`render.ts` imports its `CSS`/`BODY`/`SCRIPT` constants from there.

On a fresh clone, your editor's TypeScript server may report a missing
`./render.generated` module until you run one of those commands once. Use
`pnpm typecheck:client` to type-check just the client code without
touching the rest of the build.
