import type { ScanResult, TreeNode, TreeRenderData } from "../types";
import { buildReportMeta, reportPage, type ReportOptions } from "./reportPage";
import { BODY_TREE, CSS_TREE, SCRIPT_TREE } from "./render.generated";

export type TreeOptions = ReportOptions;

/** Renders a self-contained HTML file: a pannable, collapsible SVG tree of the scanned graph. */
export function renderTreeHtml(
  forest: TreeNode[],
  scanResult: ScanResult,
  options: TreeOptions,
): string {
  const data: TreeRenderData = {
    ...buildReportMeta(scanResult, options),
    forest,
  };

  return reportPage({
    title: options.title,
    css: CSS_TREE,
    body: BODY_TREE,
    script: SCRIPT_TREE,
    data,
  });
}
