import type { RenderData, ScanResult, TreeNode } from "../types";
import { buildReportMeta, reportPage, type ReportOptions } from "./reportPage";
import { BODY, CSS, SCRIPT } from "./render.generated";

export type RenderOptions = ReportOptions;

/** Renders a self-contained HTML file: a pannable, collapsible SVG tree of the scanned graph. */
export function renderHtml(
  forest: TreeNode[],
  scanResult: ScanResult,
  options: RenderOptions,
): string {
  const data: RenderData = {
    ...buildReportMeta(scanResult, options),
    forest,
  };

  return reportPage({
    title: options.title,
    css: CSS,
    body: BODY,
    script: SCRIPT,
    data,
  });
}
