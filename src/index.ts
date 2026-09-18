export { scan, layersOf } from './engine/scan';
export type { ScanOptions } from './engine/scan';
export { carriesTypesOnly, computeTypeOnlyReach } from './engine/typeOnlyReach';
export { buildForest } from './engine/buildForest';
export { buildGraph } from './engine/buildGraph';
export { computeFindings, sortFindings } from './engine/findings';
export { computeCircularImports, DEFAULT_MAX_CYCLE_LENGTH } from './engine/circularImports';
export type { CircularImportOptions } from './engine/circularImports';
export { computeDupeImports } from './engine/dupeImports';
export { computeLayerViolations } from './engine/layerViolations';
export { discoverLayers, loadLayerRules, validateLayerRules } from './engine/layerRules';
export type { LayerRules } from './engine/layerRules';
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
