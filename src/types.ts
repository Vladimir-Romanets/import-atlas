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
}

export interface ScanResult {
  root: string;
  entries: string[];
  nodes: Record<string, FileNode>;
  edges: Edge[];
  /** In-degree per node id, across the full (non-tree) graph. */
  fanIn: Record<string, number>;
  warnings: string[];
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
  /** If set, this occurrence is a compact reference — click jumps to the renderId it names. */
  ref: string | null;
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
  forest: TreeNode[];
  generatedAt: string;
}
