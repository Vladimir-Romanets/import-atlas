import { edgeKey } from "./edgeKey";
import type { Finding, ScanResult } from "./types";

const RECOMMENDATION =
  "Consolidate the separate import/export statements pulling from this module into a single line.";

/**
 * Flags every (importer, target) pair linked by more than one import/export
 * statement — a value import plus a type-only import, or two separate
 * re-export lines from the same file, say. Independent of `buildForest`'s
 * per-occurrence `hint` (`summarizeDupeImports`): this counts every such
 * pair in the whole graph, not just the ones visible from a given entry
 * point's tree.
 */
export function computeDupeImports(scanResult: ScanResult): Finding[] {
  // The pair is carried in the value rather than parsed back out of the key
  // — see `edgeKey` for why decoding one is a trap.
  const pairs = new Map<string, { from: string; to: string; count: number }>();
  for (const edge of scanResult.edges) {
    // A deferred import is not a statement that could be merged with the
    // others: `lazy(() => import('./Page'))` alongside `import type { Props }
    // from './Page'` is two different things asked of one module, and
    // consolidating them would undo the code splitting.
    if (edge.isDeferred) continue;
    const key = edgeKey(edge.from, edge.to);
    const pair = pairs.get(key);
    if (pair) pair.count++;
    else pairs.set(key, { from: edge.from, to: edge.to, count: 1 });
  }

  const findings: Finding[] = [];
  for (const { from, to, count } of pairs.values()) {
    if (count <= 1) continue;
    const fromNode = scanResult.nodes[from];
    const toNode = scanResult.nodes[to];
    findings.push({
      kind: "dupe-import",
      fileId: from,
      relPath: fromNode.relPath,
      layer: fromNode.layer,
      name: `${toNode.label} (×${count})`,
      confidence: "high",
      reason: `This file pulls from \`${toNode.relPath}\` via ${count} separate import/export statements.`,
      recommendation: RECOMMENDATION,
    });
  }

  findings.sort((a, b) => a.relPath.localeCompare(b.relPath) || a.name.localeCompare(b.name));
  return findings;
}
