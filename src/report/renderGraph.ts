import type { GraphData, GraphRenderData, ScanResult } from "../types";
import { buildReportMeta, reportPage, type ReportOptions } from "./reportPage";
import { BODY_GRAPH, CSS_GRAPH, SCRIPT_GRAPH } from "./render.generated";

export type RenderGraphOptions = ReportOptions;

/**
 * A self-contained HTML file showing the merged graph: one node per file,
 * wherever it is imported from.
 *
 * The payload is much smaller than the tree viewer's for the same scan — a
 * tree repeats a shared file once per place reaching it; this never does.
 */
export function renderGraphHtml(
  graph: GraphData,
  scanResult: ScanResult,
  options: RenderGraphOptions,
): string {
  const data: GraphRenderData = {
    ...buildReportMeta(scanResult, options),
    graph,
  };

  return reportPage({
    title: options.title,
    css: CSS_GRAPH,
    body: BODY_GRAPH,
    script: SCRIPT_GRAPH,
    data,
  });
}
