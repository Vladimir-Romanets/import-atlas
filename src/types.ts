/**
 * What a file exports through its OWN declarations. Edges say what a file
 * asks for; this says what it offers, and the gap between them is an export
 * nobody imports.
 *
 * `export ... from '...'` is absent here: a re-export is an edge, carried by
 * `Edge.exposedNames`.
 */
export interface ExportFacts {
  /** Names this file exports via its own declarations. `'default'` for a default export, whatever form it takes. */
  ownNames: string[];
  /**
   * The subset of `ownNames` declared as `interface` or `type` — names that
   * exist only in type space, so an import asking for one carries no value
   * however it is written. Lets `import { SomeType } from './x'` be read as
   * a type import without a type checker.
   *
   * A `class` is absent on purpose: it declares a value as well, and telling
   * a class used only as a type from one that is constructed needs the
   * checker this scan does without. `enum` and `namespace` are values too.
   */
  typeDeclNames: string[];
  /**
   * Property names of a default-exported object literal
   * (`const Utils = { leftPad, isBlank }; export default Utils`). Consumers
   * reach them as `Utils.leftPad` — property access the import graph cannot
   * see — so findings flag such names only at reduced confidence.
   */
  defaultAggregateNames: string[];
  /**
   * Local name the default export forwards, when it is a plain identifier
   * (`export default LoginPage`). Tells a named export that merely
   * duplicates the default apart from a genuinely dead one.
   */
  defaultLocalName: string | null;
  /**
   * True for `export = ...` (TypeScript's CommonJS interop). Named exports
   * can't be reasoned about through it, so findings skip the file.
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
  /** `null` when the file was never parsed (an asset, or a file that wouldn't parse), so findings don't read an empty list as "exports nothing". */
  exports: ExportFacts | null;
  /**
   * True when no entry point reaches this file without crossing a type-only
   * edge — the project only ever pulls it in for its types.
   *
   * Deliberately NOT a claim that the file is absent from the build: that
   * depends on `verbatimModuleSyntax` and on which tool strips the types,
   * neither of which a scan of import statements can see. See
   * `computeTypeOnlyReach`, and note the `coverageGaps` caveat there.
   *
   * A file reached both a type-only way and a value way is false here: one
   * value path is enough. A deferred edge (`isDeferred`) counts as a value
   * path — a lazy import still runs.
   */
  reachedOnlyByTypes: boolean;
}

export interface Edge {
  from: string;
  to: string;
  /** Name(s) pulled FROM the target module (`propertyName` when aliased) — what's ever been requested of it. '*' when undeterminable. */
  names: string[] | '*';
  /** For a re-export, the name(s) exposed onward to this file's own consumers (`name` when aliased — differs from `names` under `export { A as Alpha }`). Meaningless for a plain import. */
  exposedNames: string[] | '*';
  /** True for `export ... from '...'` (a re-export) as opposed to a plain `import ... from '...'` (direct usage). */
  isReexport: boolean;
  /**
   * True when the import sits inside a function and so cannot run while the
   * importing module evaluates its top level (`lazy(() =>
   * import('./Page'))`). The dependency is real and stays in the graph, but
   * carries no load-order coupling — hence the cycle and duplicate
   * detectors leave these edges out.
   */
  isDeferred: boolean;
  /**
   * True when this statement asks the target for types alone — `import type
   * { X } from`, `export type { X } from`, or every named binding on it
   * marked `type` individually. Nothing of value crosses the edge.
   *
   * Syntax, not fate: under `verbatimModuleSyntax` an inline-marked
   * `import { type A } from './a'` is emitted as `import {} from './a'` and
   * still runs the module's side effects, while the clause-level form is
   * dropped outright. What survives compilation is the toolchain's business,
   * so nothing here claims it. Not the same axis as `isDeferred`, which is
   * about when an import runs rather than what it asks for. Used to compute
   * `FileNode.reachedOnlyByTypes`.
   */
  isTypeOnly: boolean;
  /**
   * True when every name this statement asks of the target is declared there
   * as `interface` or `type` — the same conclusion as `isTypeOnly`, reached
   * by looking at what the target declares rather than at how the import was
   * written. So `import { SomeType } from './x'` counts even though it never
   * says `type`.
   *
   * Follows re-export chains, so a name forwarded through a barrel resolves
   * to wherever it is declared. False whenever the answer cannot be had:
   * `names` is `'*'`, the target was never parsed, it uses `export =`, or a
   * re-export cycle makes the name unresolvable.
   *
   * Independent of `isTypeOnly` rather than a superset of it — `import type
   * { Foo }` is type-only however `Foo` is declared. Consumers asking "does
   * anything of value cross this edge" want both.
   */
  requestsTypesOnly: boolean;
  /**
   * The subset of `exposedNames` this statement asks for as a type — each
   * one declared on the target as `interface` or `type`, chased through
   * re-export chains exactly as `requestsTypesOnly` does. Named on the
   * outward side, since that is the side a viewer prints.
   *
   * This is what `requestsTypesOnly` has to throw away. A mixed `import {
   * storeUser, FilterType }` is a value edge and must stay one — the target
   * really is reached for a value — but `FilterType` is still a type, and a
   * per-name label can say so where a per-edge flag cannot.
   *
   * A lower bound, never a partition: empty whenever the names can't be
   * pinned down (`'*'` on either side), and blind to syntax, so `import {
   * type Foo }` on a `class Foo` is absent. A name missing here is a name
   * the graph couldn't call a type, not one it calls a value. Clause-level
   * `import type` doesn't come through here at all — `isTypeOnly` already
   * makes every name on the statement a type name.
   */
  typeOnlyNames: string[];
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
   * `--max-files` cap, a file that would not parse, a specifier that would
   * not resolve. Empty means every file reachable from the entries was read.
   *
   * `--exclude` omissions are NOT listed: they were requested. Consumers
   * outside the entries' reach are invisible to the walk entirely.
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
 * A row in the Findings tab. `dead-export`/`dead-reexport` are per-export;
 * `circular-import`/`dupe-import` are whole-graph structural findings, whose
 * `name`/`relPath` carry a file count / path chain instead of an export name.
 */
export interface Finding {
  /**
   * `dead-export` for a name the file declares itself; `dead-reexport` for
   * one it forwards with `export ... from`; `circular-import` for one loop
   * of files importing each other (or a self-import); `dupe-import` for one
   * target module pulled in via several statements from the same file;
   * `layer-violation` for one import that crosses a layer boundary a
   * layer-rules file does not allow.
   */
  kind: 'dead-export' | 'dead-reexport' | 'circular-import' | 'dupe-import' | 'layer-violation';
  fileId: string;
  /**
   * Every file the finding covers, when that is more than `fileId` — for a
   * `circular-import`, the files on the loop, `fileId` first; for a
   * `layer-violation`, the importing file and the one it reaches into.
   * Rows from one tangled group overlap on purpose: unioning `fileIds ??
   * [fileId]` is how affected files are counted without double-counting a
   * shared file.
   */
  fileIds?: string[];
  relPath: string;
  layer: string;
  /**
   * `dead-export`/`dead-reexport`: the exported name as consumers write it.
   * `circular-import`: how many files are on the loop (`"3 files"`), or
   * `"self-import"`. `dupe-import`: the module's label and statement count
   * (`"Button (×2)"`). `layer-violation`: the relative path of the file
   * reached into.
   */
  name: string;
  confidence: FindingConfidence;
  /**
   * Why this was flagged — below `high`, also what could still keep it
   * alive. For `circular-import`, the context one loop cannot carry: the
   * size of the mutually-reachable group, and how many loops it holds.
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
  /** Set when this file imports the same child module via more than one statement (a value import plus a type-only one, say). */
  hint: string;
  /** If set, this occurrence is a compact reference — click jumps to the renderId it names. */
  ref: string | null;
  /** What this occurrence's own parent edge calls it by — that edge's `exposedNames` (for a re-export, the outward name). '*' for an entry point, or when the names couldn't be determined. Drives the viewer's primary label, falling back to the file's own name on '*'. */
  importedAs: string[] | '*';
  /** Whether the edge from this occurrence's parent is lazy — every statement linking the pair is a dynamic `import()` or an in-function `require`. False for a root. Drawn dotted. */
  isDeferred: boolean;
  /** Copied from the underlying `FileNode` — see its doc. A property of the file across the whole graph, not of this occurrence. Drawn as a dashed border. */
  reachedOnlyByTypes: boolean;
  /**
   * The subset of `importedAs` that this parent ever imports ONLY as a
   * type — never also as a value. Local to this occurrence's parent edge,
   * unlike `reachedOnlyByTypes`: the same file can be a type here and a value
   * under a different parent. `'*'` (namespace import, dynamic import,
   * `require()`, or an entry point) always yields an empty list here, since
   * there are no individual names to mark.
   */
  importedAsTypeOnly: string[];
  fanIn: number;
  children: TreeNode[];
}

/**
 * Everything a report carries about the scan itself, independent of how the
 * graph is drawn. Both viewers embed one, so the sidebar/Findings code that
 * reads nothing else works in either.
 */
export interface ReportMeta {
  title: string;
  /** Just the scanned folder's name, not its full path. */
  root: string;
  entries: string[];
  layers: string[];
  layerCounts: Record<string, number>;
  topFanIn: { path: string; count: number }[];
  warnings: string[];
  /** `ScanResult.coverageGaps` — non-empty puts a caveat above the Findings list, since a file the walk never read could be the one importing a name listed there. */
  coverageGaps: string[];
  /**
   * For the Findings tab, in three fixed blocks, each rendered as its own
   * group section: dead-export/dead-reexport (most trustworthy first),
   * then circular-import, then dupe-import.
   */
  findings: Finding[];
  generatedAt: string;
}

/** The JSON payload embedded into the generated HTML report for the tree viewer's client script. */
export interface TreeRenderData extends ReportMeta {
  forest: TreeNode[];
}

/**
 * One file in the graph view.
 *
 * Where `TreeNode` is one *occurrence* — one per place that reaches the file
 * — this is one *file*, however many importers it has: the shared module is
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
   * How many distinct local files import this one — exactly how many edges
   * arrive at it on screen.
   *
   * Not `ScanResult.fanIn`, which counts import *statements* and so is
   * larger wherever one file imports another twice; that repetition lives
   * on the edge, as `GraphEdge.statements`.
   */
  fanIn: number;
  /** How many distinct local files this one imports. */
  fanOut: number;
  /**
   * Length of the LONGEST path from an entry point, over forward edges only
   * — a property of the whole project, not a screen position. (The viewer
   * re-measures depth over what is currently on screen to pick columns.)
   * Used for ordering: it sorts the payload so a node comes after everything
   * upstream of it, and two runs over an unchanged project agree.
   */
  depth: number;
  isEntry: boolean;
  /**
   * Discovery position in the depth-first walk from the entries. A tiebreak
   * only: it gives the layout a stable, import-order-ish sequence within a
   * column, so two runs over an unchanged project draw the same picture.
   */
  order: number;
  /** Copied from the underlying `FileNode` — see its doc. Drawn as a dashed border, or faded where the zoom draws nodes without one. */
  reachedOnlyByTypes: boolean;
}

/**
 * One drawn edge: every statement linking the same pair of files collapsed
 * into a single line, since they occupy the same place on screen.
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
  /** True only when EVERY collapsed statement is type-only — one runtime statement among them makes the pair a real dependency. */
  isTypeOnly: boolean;
  /** How many statements collapsed into this edge, deferred ones included. */
  statements: number;
  /**
   * How many of those statements could be merged into one line — the same
   * count `dupe-import` reports, so a viewer warning always has a row
   * behind it. Deferred statements are left out: `lazy(() =>
   * import('./Page'))` beside `import type { Props } from './Page'` is two
   * things asked of one module, and merging them would undo code splitting.
   */
  mergeableStatements: number;
  /**
   * True when this edge closes a cycle: layering left it out to get an
   * acyclic graph, so it is the one edge that can point leftwards (or, for
   * a self-import, at its own source). Drawn distinctly rather than dropped
   * — the dependency is real.
   */
  isBackEdge: boolean;
}

/** The graph (DAG) view of a scan: one node per file, one edge per file pair. */
export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Entry point file ids, in the order they were given to the scan. */
  entries: string[];
  /** Largest `depth` among the nodes — how many columns the layout spans. */
  maxDepth: number;
}

/** The JSON payload embedded into the generated HTML report for the graph viewer's client script. */
export interface GraphRenderData extends ReportMeta {
  graph: GraphData;
}
