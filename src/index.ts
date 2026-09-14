export { scan } from './engine/scan';
export type { ScanOptions } from './engine/scan';
export { buildForest } from './engine/buildForest';
export { buildGraph } from './engine/buildGraph';
export { computeFindings, sortFindings } from './engine/findings';
export { computeCircularImports, DEFAULT_MAX_CYCLE_LENGTH } from './engine/circularImports';
export type { CircularImportOptions } from './engine/circularImports';
export { computeDupeImports } from './engine/dupeImports';
export { renderHtml } from './report/render';
export type { RenderOptions } from './report/render';
export { renderGraphHtml } from './report/renderGraph';
export type { RenderGraphOptions } from './report/renderGraph';
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
  RenderData,
  ReportMeta,
  ScanResult,
  TreeNode,
} from './types';
