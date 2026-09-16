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

The Findings tab is three separate detectors over one `scan()` result. Each returns a `Finding[]` and each works alone:

```ts
import {
  computeFindings,
  computeCircularImports,
  computeDupeImports,
  sortFindings,
} from "import-atlas";

// exactly what the renderers put in the Findings tab, in the same order
const findings = sortFindings([
  ...computeFindings(result), // unimported exports and re-exports
  ...computeCircularImports(result), // import cycles, one row per loop
  // takes { maxCycleLength } — default 4
  ...computeDupeImports(result), // one module imported by several statements
]);
```

`sortFindings()` is what puts the merged list in most-trustworthy-first order; inside one confidence level each detector keeps its own row order. Drop it if you only want one detector, or want to order the rows yourself.
