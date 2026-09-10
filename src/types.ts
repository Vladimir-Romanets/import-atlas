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
  /** True when THIS specific parent->child edge never requested the child by name — per-occurrence, so the same file can be `unused` under one parent and not another. Drives the "hide unused" view. */
  unused: boolean;
  /** Name(s) THIS occurrence's own direct parent edge calls it by — `exposedNames` of that one edge (for a plain import, identical to what's pulled; for a re-export, the forwarded/outward name, e.g. 'Button' even when the file itself pulls its default export internally as something else). '*' for an entry point, or when the edge's names couldn't be determined (namespace import, dynamic import, `require`, `export * from`). Drives the node's primary label in the viewer — falls back to the file's own name when '*'. */
  importedAs: string[] | '*';
  fanIn: number;
  children: TreeNode[];
}

/** The JSON payload embedded into the generated HTML report for the graph viewer's client script. */
export interface RenderData {
  title: string;
  root: string;
  entries: string[];
  layers: string[];
  layerCounts: Record<string, number>;
  topFanIn: { path: string; count: number }[];
  warnings: string[];
  /** `ScanResult.coverageGaps` — non-empty disables the viewer's "Unused hidden" toggle, since nothing is flagged `unused` when the walk admits it missed edges. */
  coverageGaps: string[];
  forest: TreeNode[];
  generatedAt: string;
}
