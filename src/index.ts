export { scan } from './engine/scan';
export type { ScanOptions } from './engine/scan';
export { buildForest } from './engine/buildForest';
export { buildGraph } from './engine/buildGraph';
export { computeFindings, sortFindings } from './engine/findings';
export { computeCircularImports, DEFAULT_MAX_CYCLE_LENGTH } from './engine/circularImports';
export type { CircularImportOptions } from './engine/circularImports';
export { computeDupeImports } from './engine/dupeImports';
export { renderTreeHtml } from './report/render.tree';
export type { TreeOptions } from './report/render.tree';
export { renderGraphHtml } from './report/render.graph';
export type { GraphOptions } from './report/render.graph';
export type {
  Edge,
  ExportFacts,
  FileNode,
  Finding,
  FindingConfidence,
  GraphData,
  GraphEdge,
  GraphNode,
  GraphRenderData,
  ReportMeta,
  ScanResult,
  TreeNode,
  TreeRenderData,
} from './types';
