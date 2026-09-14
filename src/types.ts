/**
 * What a file exports through its OWN declarations — the other half of the
 * import graph. Edges say what every file *asks* for; this says what each
 * file *offers*, and the difference between the two is an export nobody
 * imports.
 *
 * `export ... from '...'` is deliberately absent here: a re-export is an
 * edge, already carried by `Edge.exposedNames`, and is judged as one.
 */
export interface ExportFacts {
  /** Names this file exports via its own declarations. `'default'` for a default export, whatever form it takes. */
  ownNames: string[];
  /**
   * When the default export is an object literal gathering local bindings
   * (`const Utils = { leftPad, isBlank }; export default Utils`), the
   * property names it carries. Those bindings stay reachable to consumers
   * as `Utils.leftPad` — property access on an imported binding, which an
   * import graph cannot see. Their named exports therefore look unimported
   * while the symbols are very much alive, so findings flag them only at
   * reduced confidence.
   */
  defaultAggregateNames: string[];
  /**
   * Local name the default export forwards, when it is a plain identifier
   * (`export default LoginPage`). Lets a named export that merely duplicates
   * the default be told apart from a genuinely dead one.
   */
  defaultLocalName: string | null;
  /**
   * True for `export = ...` (TypeScript's CommonJS interop). The file's
   * named exports can't be reasoned about through it, so findings skip the
   * file entirely rather than guess.
   */
  hasExportEquals: boolean;
}

export interface FileNode {
  /** Stable id: POSIX-style path relative to the scan root. */
  id: string;
  absPath: string;
  relPath: string;
  /** Basename without extension. */
  label: string;
  /** First path segment under `src/` (or project root), used to color/group nodes. */
  layer: string;
  /** Bare/package specifiers imported by this file (not resolved to a local file). */
  externalImports: string[];
  /** Specifiers that looked local/aliased but could not be resolved to a file on disk. */
  unresolvedImports: string[];
  /** `null` when the file was never parsed — a non-JS/TS asset, or a file that wouldn't parse. Findings skip those rather than read an empty export list as "exports nothing". */
  exports: ExportFacts | null;
}

export interface Edge {
  from: string;
  to: string;
  /** Name(s) this statement pulls FROM the target module (`propertyName` when aliased) — used to compute what's ever been requested of the target file. '*' when that can't be determined. */
  names: string[] | '*';
  /** For a re-export, the name(s) this file exposes onward to its own consumers via this statement (`name` when aliased — can differ from `names` under `export { A as Alpha }`). Meaningless for a plain import. */
  exposedNames: string[] | '*';
  /** True for `export ... from '...'` (a re-export) as opposed to a plain `import ... from '...'` (direct usage). */
  isReexport: boolean;
  /**
   * True when the import sits inside a function and so cannot run while the
   * importing module evaluates its own top level — `lazy(() =>
   * import('./Page'))`, a `require()` in a branch. The dependency is real,
   * so the edge stays in the graph and in the tree; but it carries none of
   * the load-order coupling a module-scope import does, which is why the
   * cycle and duplicate detectors leave these edges out.
   */
  isDeferred: boolean;
}

export interface ScanResult {
  root: string;
  entries: string[];
  nodes: Record<string, FileNode>;
  edges: Edge[];
  /** In-degree per node id, across the full (non-tree) graph. */
  fanIn: Record<string, number>;
  warnings: string[];
  /**
   * Reasons the walk missed import edges it did not mean to skip — the
   * `--max-files` cap firing, a file that would not parse, a specifier that
   * would not resolve. Empty means every file reachable from the entry
   * points was read in full.
   *
   * Files dropped by `--exclude` are deliberately NOT listed: that omission
   * was requested, so the graph still matches what the user asked to see.
   * Consumers that simply live outside the entry points' reach are invisible
   * to the walk and cannot be reported here at all.
   */
  coverageGaps: string[];
}

/**
 * How much to trust a finding. The import graph sees names crossing module
 * boundaries and nothing else, so some exports look unimported for reasons
 * that have nothing to do with being dead — see `Finding.reason`.
 */
export type FindingConfidence = 'high' | 'medium' | 'low';

/**
 * Something worth a reader's attention in the Findings tab. `dead-export`/
 * `dead-reexport` are per-export findings (see field docs below for their
 * shape); `circular-import`/`dupe-import` are whole-graph structural
 * findings, where `name`/`relPath` carry a file count / path chain instead
 * of an export name.
 */
export interface Finding {
  /**
   * `dead-export` for a name the file declares itself; `dead-reexport` for
   * one it forwards with `export ... from`; `circular-import` for one loop
   * of files that import each other, or a file that imports itself;
   * `dupe-import` for the same target module pulled in via more than one
   * import/export statement from the same file.
   */
  kind: 'dead-export' | 'dead-reexport' | 'circular-import' | 'dupe-import';
  fileId: string;
  /**
   * Every file the finding covers, when that is more than `fileId` alone —
   * for a `circular-import`, the files on the loop, of which `fileId` is the
   * first. Rows from one tangled group overlap here on purpose: the same
   * file can sit on many loops, and unioning `fileIds ?? [fileId]` across
   * findings is how affected files are counted without double-counting it.
   */
  fileIds?: string[];
  relPath: string;
  layer: string;
  /**
   * For `dead-export`/`dead-reexport`: the exported name, as consumers
   * would have to write it. For `circular-import`: how many files are on the
   * loop, which is exactly how many `relPath` names (`"3 files"`), or
   * `"self-import"`. For `dupe-import`: the imported module's label plus how
   * many times it was imported (`"Button (×2)"`).
   */
  name: string;
  confidence: FindingConfidence;
  /**
   * Why this was flagged. For `dead-export`/`dead-reexport`, below `high`,
   * also what could still keep it alive. For `circular-import`, the context
   * one loop cannot carry on its own: how large the mutually-reachable group
   * around it is, and how many other loops were found in that group.
   */
  reason: string;
  /** What to do about it. */
  recommendation: string;
}

export interface TreeNode {
  /** Unique id for this rendered occurrence (a file can appear more than once). */
  renderId: string;
  /** The underlying file's id (shared by every occurrence of the same file). */
  fileId: string;
  label: string;
  relPath: string;
  layer: string;
  note: string;
  warn: string;
  /** Set when this file imports the same child module via more than one statement (e.g. a value import plus a type-only import, or two re-export lines). */
  hint: string;
  /** If set, this occurrence is a compact reference — click jumps to the renderId it names. */
  ref: string | null;
  /** Name(s) THIS occurrence's own direct parent edge calls it by — `exposedNames` of that one edge (for a plain import, identical to what's pulled; for a re-export, the forwarded/outward name, e.g. 'Button' even when the file itself pulls its default export internally as something else). '*' for an entry point, or when the edge's names couldn't be determined (namespace import, dynamic import, `require`, `export * from`). Drives the node's primary label in the viewer — falls back to the file's own name when '*'. */
  importedAs: string[] | '*';
  /** Whether the edge from THIS occurrence's parent is lazy — every statement linking the pair is a dynamic `import()` or a `require` inside a function. False for a root, which nothing imports. Drawn dotted. */
  isDeferred: boolean;
  fanIn: number;
  children: TreeNode[];
}

/**
 * Everything a generated report carries about the scan itself, independent
 * of how the graph is drawn. Both viewers embed one of these, and the
 * sidebar/Findings code that reads nothing else works in either.
 */
export interface ReportMeta {
  title: string;
  root: string;
  entries: string[];
  layers: string[];
  layerCounts: Record<string, number>;
  topFanIn: { path: string; count: number }[];
  warnings: string[];
  /** `ScanResult.coverageGaps` — non-empty puts a caveat above the Findings list, since a file the walk never read could be the one importing a name listed there. */
  coverageGaps: string[];
  /**
   * For the viewer's Findings tab, in three fixed blocks: dead-export/
   * dead-reexport findings first (most-trustworthy first within that
   * block), then circular-import findings, then dupe-import findings —
   * each block internally sorted and always rendered as its own group
   * section(s).
   */
  findings: Finding[];
  generatedAt: string;
}

/** The JSON payload embedded into the generated HTML report for the tree viewer's client script. */
export interface RenderData extends ReportMeta {
  forest: TreeNode[];
}

/**
 * One file in the merged graph view.
 *
 * Where `TreeNode` is one *occurrence* — the same file appears once per
 * place that reaches it — this is one *file*, however many importers it
 * has. That is the whole point of the merged view: the shared module is
 * drawn once, with an edge coming in from each of them.
 */
export interface GraphNode {
  /** The file's id, POSIX-style path relative to the scan root. Unique here, unlike a tree node's `renderId`. */
  id: string;
  label: string;
  relPath: string;
  layer: string;
  /** Summary of the file's external (package) imports — the same text the tree viewer puts on a node. */
  note: string;
  /**
   * How many distinct local files import this one — which is exactly how
   * many edges arrive at it on screen.
   *
   * Deliberately not `ScanResult.fanIn`, which counts import *statements*
   * and so is larger wherever one file imports another twice. Here the
   * repetition lives on the edge, as `GraphEdge.statements`.
   */
  fanIn: number;
  /** How many distinct local files this one imports. */
  fanOut: number;
  /**
   * How far the file is from an entry point at its furthest: the length of
   * the LONGEST path to it, counted over forward edges only.
   *
   * This is a property of the whole project, not a screen position. The
   * viewer measures the same thing again over whatever is currently on
   * screen to decide which column to draw a node in, because a file that
   * an entry imports directly and a deep chain also reaches belongs beside
   * the entry when only the entry is open. What this is for is ordering:
   * it sorts the payload so a node is defined after the things upstream of
   * it, and two runs over an unchanged project produce the same file.
   */
  depth: number;
  isEntry: boolean;
  /**
   * Discovery position in the depth-first walk from the entry points. Only
   * a tiebreak: it gives the layout a stable, import-order-ish starting
   * sequence within a column, so two runs over an unchanged project draw
   * the same picture.
   */
  order: number;
}

/**
 * One drawn edge: every import/export statement linking the same pair of
 * files collapsed into a single line, since in the merged view they occupy
 * the same place on screen.
 */
export interface GraphEdge {
  from: string;
  to: string;
  /** Union of the names every collapsed statement pulls from the target. `'*'` if any of them couldn't be pinned down. */
  names: string[] | '*';
  /** Union of what those statements expose onward, for the re-export among them. `'*'` under the same conditions. */
  exposedNames: string[] | '*';
  /** True when ANY collapsed statement is a re-export. */
  isReexport: boolean;
  /** True only when EVERY collapsed statement is deferred — one module-scope import among them is enough to make the dependency load-bearing. */
  isDeferred: boolean;
  /** How many statements collapsed into this edge, deferred ones included. */
  statements: number;
  /**
   * How many of those statements could actually be merged into one line —
   * the same count `dupe-import` findings report, so a viewer warning drawn
   * from this always has a row behind it. Deferred statements are left out:
   * `lazy(() => import('./Page'))` next to `import type { Props } from
   * './Page'` is two things asked of one module, and consolidating them
   * would undo the code splitting.
   */
  mergeableStatements: number;
  /**
   * True when this edge closes a cycle: layering had to leave it out to get
   * an acyclic graph to lay out, so it is the one kind of edge that can
   * point leftwards (or, for a self-import, at its own source). Drawn
   * distinctly rather than dropped — the dependency is real.
   */
  isBackEdge: boolean;
}

/** The merged (DAG) view of a scan: one node per file, one edge per file pair. */
export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Entry point file ids, in the order they were given to the scan. */
  entries: string[];
  /** Largest `depth` among the nodes — how many columns the layout spans. */
  maxDepth: number;
}

/** The JSON payload embedded into the generated HTML report for the merged graph viewer's client script. */
export interface GraphRenderData extends ReportMeta {
  graph: GraphData;
}
