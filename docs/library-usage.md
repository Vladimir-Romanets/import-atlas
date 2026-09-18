# Using it as a library

```ts
import { scan, buildForest, renderTreeHtml } from "import-atlas";

// pass every route/page you want covered — with a file-system router
// that means more than just the root layout, see docs/file-system-routers.md
const result = scan(["src/index.ts"], { root: process.cwd() });
const forest = buildForest(result);
const html = renderTreeHtml(forest, result, { title: "My app" });
```

`scan()` returns the whole graph (`nodes`, `edges`, per-node fan-in) and `buildForest()` turns it into the tree the HTML renderer expects. Either is useful on its own if you want your own report format.

The graph report is the same scan through a different pair:

```ts
import { scan, buildGraph, renderGraphHtml } from "import-atlas";

const result = scan(["src/index.ts"], { root: process.cwd() });
const graph = buildGraph(result); // one node per file, one edge per pair
const html = renderGraphHtml(graph, result, { title: "My app" });
```

`buildGraph()` is worth having on its own: it collapses the repeated statements between a pair of files into one edge, counts how many files import each file, works out how far each sits from an entry point, and marks the edges that close cycles — all of it plain data, and none of it needing the viewer.

A scan also marks what the project only ever imports for its types. Five fields carry that, from one statement up to the whole graph:

- **`Edge.isTypeOnly`** — the statement said so: `import type { X } from`, or every named binding on it marked `type`. `GraphEdge` has it too, aggregated like `isDeferred`: one value statement among those collapsed into an edge makes the whole edge a value edge.
- **`Edge.requestsTypesOnly`** — the same conclusion from the target's side: every name asked for is declared there as an `interface` or a `type`, so `import { SomeType } from './x'` counts without ever saying `type`. Follows re-export chains through barrels to wherever the name is declared.
- **`Edge.typeOnlyNames`** — the per-name verdicts `requestsTypesOnly` collapses into one boolean, named on the outward side so a barrel's rename comes through. `import { storeUser, FilterType }` is a value edge carrying `typeOnlyNames: ['FilterType']`. Empty on a clause-level `import type`, which `isTypeOnly` already covers wholesale.
- **`FileNode.reachedOnlyByTypes`**, copied onto `GraphNode` and `TreeNode` — no entry point reaches the file without crossing an edge that carries types only. A deferred edge is a real, if late, path and is traversed.
- **`TreeNode.importedAsTypeOnly`** — the subset of one occurrence's `importedAs` this parent pulls only as a type. Per name, so a mixed import marks `FilterType` on a node that is not `reachedOnlyByTypes` at all. A name any statement on the pair imports as a value is excluded, as is every name once a non-type-only statement pulls something unnameable (`import * as X`).

`carriesTypesOnly(edge)` is the exported predicate for "nothing of value crosses here" — the first two together, which are independent facts rather than one a superset of the other. `computeTypeOnlyReach()` is the fourth on its own:

```ts
import { scan, computeTypeOnlyReach } from "import-atlas";

const result = scan(["src/index.ts"], { root: process.cwd() });
const typeOnly = computeTypeOnlyReach(result); // Set<string> of file ids
```

All of it reads declarations, not types: `FileNode.exports.typeDeclNames` lists a file's own type-space exports, and a `class` is deliberately absent since it declares a value too. So every field above is a lower bound — false or empty wherever the answer can't be had (a `'*'` request, an unparsed target, `export =`, a re-export cycle), never a claim that the rest are values. None of it says the file is absent from a build either: that depends on `verbatimModuleSyntax` and on whether tsc, esbuild, swc or babel strips the types. And it is only as complete as the edges the scan recorded, so a non-empty `coverageGaps` is as much a caveat here as for findings.

The Findings tab is four separate detectors over one `scan()` result. Each returns a `Finding[]` and each works alone:

```ts
import {
  computeFindings,
  computeCircularImports,
  computeDupeImports,
  computeLayerViolations,
  sortFindings,
} from "import-atlas";

// exactly what the renderers put in the Findings tab, in the same order
const findings = sortFindings([
  ...computeFindings(result), // unimported exports and re-exports
  ...computeCircularImports(result), // import cycles, one row per loop
  // takes { maxCycleLength } — default 4
  ...computeDupeImports(result), // one module imported by several statements
  ...computeLayerViolations(result, rules), // imports crossing a disallowed layer boundary
]);
```

`sortFindings()` is what puts the merged list in most-trustworthy-first order; inside one confidence level each detector keeps its own row order. Drop it if you only want one detector, or want to order the rows yourself.

`computeLayerViolations()` needs a `LayerRules` object — `Record<string, '*' | string[]>`, mapping each layer name to what it may import from (`'*'` for anywhere, an array for an explicit allowlist, or omit the key / use `[]` to forbid all cross-layer imports). `layersOf(result)` returns the real layer names a given scan produced, and `loadLayerRules(path)`/`validateLayerRules(result, rules)` read a rules file off disk and check it still matches the scan (an unknown layer named anywhere in the file — a key or an allowlist entry — or a real layer missing from it, comes back as a warning string rather than failing silently). `discoverLayers(root)` is the other way to get layer names — read straight off the directory tree rather than from a scan result, which is what `import-atlas init-rules` uses so it needs no entry files. It mirrors the two places `layerOf` takes a layer from: every top-level directory under `root` plus the children of `root/src`, skipping tooling directories by name and any directory holding no parseable source file at all (a `docs/`, a `public/`), since no scanned file could ever carry that layer:

```ts
import { loadLayerRules, validateLayerRules, computeLayerViolations } from "import-atlas";

const rules = loadLayerRules("import-atlas.rules.json");
for (const warning of validateLayerRules(result, rules)) console.warn(warning);
const violations = computeLayerViolations(result, rules);
```
