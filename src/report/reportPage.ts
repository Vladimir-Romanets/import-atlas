import path from "node:path";
import { computeCircularImports } from "../engine/circularImports";
import { computeDupeImports } from "../engine/dupeImports";
import { computeFindings, sortFindings } from "../engine/findings";
import { stringifyDeep } from "../utils/stringifyDeep";
import type { ReportMeta, ScanResult } from "../types";

export interface ReportOptions {
  title: string;
  /** Longest circular-import loop reported as its own row. See `DEFAULT_MAX_CYCLE_LENGTH`. */
  maxCycleLength?: number;
}

/**
 * Everything a report says about the scan itself — the sidebar's legend and
 * fan-in table, the Findings tab, the warnings. Both viewers share it and
 * differ only in how they draw the graph.
 */
export function buildReportMeta(
  scanResult: ScanResult,
  options: ReportOptions,
): ReportMeta {
  const layerCounts: Record<string, number> = {};
  for (const node of Object.values(scanResult.nodes)) {
    layerCounts[node.layer] = (layerCounts[node.layer] || 0) + 1;
  }
  const layers = Object.keys(layerCounts).sort(
    (a, b) => layerCounts[b] - layerCounts[a],
  );

  const topFanIn = Object.entries(scanResult.fanIn)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([id, count]) => ({
      path: scanResult.nodes[id]?.relPath || id,
      count,
    }));

  return {
    title: options.title,
    root: path.basename(scanResult.root),
    entries: scanResult.entries.map(
      (id) => scanResult.nodes[id]?.relPath || id,
    ),
    layers,
    layerCounts,
    topFanIn,
    warnings: scanResult.warnings,
    coverageGaps: scanResult.coverageGaps,
    findings: sortFindings([
      ...computeFindings(scanResult),
      ...computeCircularImports(scanResult, {
        maxCycleLength: options.maxCycleLength,
      }),
      ...computeDupeImports(scanResult),
    ]),
    generatedAt: new Date().toISOString(),
  };
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export interface ReportPage {
  title: string;
  css: string;
  body: string;
  script: string;
  /** The viewer's payload, serialized into the page as `window.__IMPORT_ATLAS_DATA__`. */
  data: unknown;
}

/** Wraps one viewer's assets and payload into the self-contained HTML file. */
export function reportPage({
  title,
  css,
  body,
  script,
  data,
}: ReportPage): string {
  // `</script>` inside the payload would close the tag it sits in; escaping
  // every `<` is the blunt version of that check, costing a few bytes of a
  // file nobody reads by hand.
  //
  // `stringifyDeep`, not `JSON.stringify`: the tree payload nests one level
  // per import-chain link, and a deep enough chain overflows the call stack
  // `JSON.stringify` recurses over.
  const dataJson = stringifyDeep(data).replace(/</g, "\\u003c");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg%20width%3D%22200%22%20height%3D%22190%22%20viewBox%3D%220%200%20200%20190%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Cdefs%3E%3ClinearGradient%20id%3D%22g%22%20x1%3D%2220%25%22%20y1%3D%220%25%22%20x2%3D%2280%25%22%20y2%3D%22100%25%22%3E%3Cstop%20offset%3D%220%25%22%20stop-color%3D%22%234F7FE0%22%2F%3E%3Cstop%20offset%3D%2250%25%22%20stop-color%3D%22%234FC3A1%22%2F%3E%3Cstop%20offset%3D%22100%25%22%20stop-color%3D%22%237ED957%22%2F%3E%3C%2FlinearGradient%3E%3C%2Fdefs%3E%3Cpath%20d%3D%22M100%2055C100%2095%2060%2095%2060%20140M100%2055C100%2095%20140%2095%20140%20140%22%20fill%3D%22none%22%20stroke%3D%22url(%23g)%22%20stroke-width%3D%2214%22%20stroke-linecap%3D%22round%22%2F%3E%3Ccircle%20cx%3D%22100%22%20cy%3D%2235%22%20r%3D%2220%22%20fill%3D%22none%22%20stroke%3D%22url(%23g)%22%20stroke-width%3D%2214%22%2F%3E%3Ccircle%20cx%3D%2260%22%20cy%3D%22160%22%20r%3D%2220%22%20fill%3D%22none%22%20stroke%3D%22url(%23g)%22%20stroke-width%3D%2214%22%2F%3E%3Ccircle%20cx%3D%22140%22%20cy%3D%22160%22%20r%3D%2227%22%20fill%3D%22url(%23g)%22%2F%3E%3C%2Fsvg%3E">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style>
${css}
</style>
</head>
<body>
${body}
<script>
window.__IMPORT_ATLAS_DATA__ = ${dataJson};
${script}
</script>
</body>
</html>
`;
}
