import type { ScanResult, TreeNode, RenderData } from "./types";
import { computeFindings } from "./findings";
import { CSS, BODY, SCRIPT } from "./render.generated";

export interface RenderOptions {
  title: string;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Renders a self-contained HTML file: a pannable, collapsible SVG tree of the scanned graph. */
export function renderHtml(
  forest: TreeNode[],
  scanResult: ScanResult,
  options: RenderOptions,
): string {
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

  // `buildForest` marks nothing unused once the walk reports gaps, so say so
  // here rather than leaving a toggle that silently hides nothing.
  const warnings =
    scanResult.coverageGaps.length > 0
      ? [
          ...scanResult.warnings,
          `Hiding unused re-exports is unavailable: the scan missed import edges (${scanResult.coverageGaps.join("; ")}), and a file it never read could be the one requesting a re-exported name.`,
        ]
      : scanResult.warnings;

  const data: RenderData = {
    title: options.title,
    root: scanResult.root,
    entries: scanResult.entries.map(
      (id) => scanResult.nodes[id]?.relPath || id,
    ),
    layers,
    layerCounts,
    topFanIn,
    warnings,
    coverageGaps: scanResult.coverageGaps,
    findings: computeFindings(scanResult),
    forest,
    generatedAt: new Date().toISOString(),
  };

  const dataJson = JSON.stringify(data).replace(/</g, "\\u003c");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(options.title)}</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>🌳</text></svg>">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style>
${CSS}
</style>
</head>
<body>
${BODY}
<script>
window.__IMPORT_ATLAS_DATA__ = ${dataJson};
${SCRIPT}
</script>
</body>
</html>
`;
}
