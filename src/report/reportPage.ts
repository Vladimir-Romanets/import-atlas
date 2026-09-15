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
 * fan-in table, the Findings tab, the warnings. Shared by both viewers,
 * which differ only in how they draw the graph.
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
    root: scanResult.root,
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
  // `</script>` inside the payload would close the tag it is sitting in;
  // escaping every `<` is the blunt version of that check, and costs a few
  // bytes of a file nobody reads by hand.
  //
  // `stringifyDeep`, not `JSON.stringify`, because the tree payload nests
  // one level per import-chain link and a deep enough chain overflows the
  // call stack `JSON.stringify` recurses over.
  const dataJson = stringifyDeep(data).replace(/</g, "\\u003c");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>🌳</text></svg>">
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
