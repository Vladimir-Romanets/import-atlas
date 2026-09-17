import { edgeKey } from '../utils/edgeKey';
import type { Finding, ScanResult } from '../types';
import type { LayerRules } from './layerRules';

const RECOMMENDATION =
  'Route the dependency through a layer the source is allowed to import from, or add the target layer to the source layer\'s allowlist in the rules file if this crossing is intentional.';

function isAllowed(rules: LayerRules, fromLayer: string, toLayer: string): boolean {
  const allowed = rules[fromLayer];
  if (allowed === '*') return true;
  if (!Array.isArray(allowed)) return false;
  return allowed.includes(toLayer);
}

/**
 * Every (importer, target file) pair crossing a disallowed layer boundary,
 * deduplicated by `edgeKey(from, to)` like `computeDupeImports` — otherwise
 * a module imported twice (value + type-only) double-counts.
 *
 * Deferred edges are NOT excluded here, unlike `computeCircularImports`/
 * `computeDupeImports`: those care about load order, but a lazy import
 * still crosses the same architectural boundary a static one would.
 */
export function computeLayerViolations(scanResult: ScanResult, rules: LayerRules): Finding[] {
  const pairs = new Map<string, { from: string; to: string }>();
  for (const edge of scanResult.edges) {
    const key = edgeKey(edge.from, edge.to);
    if (!pairs.has(key)) pairs.set(key, { from: edge.from, to: edge.to });
  }

  const findings: Finding[] = [];
  for (const { from, to } of pairs.values()) {
    const fromNode = scanResult.nodes[from];
    const toNode = scanResult.nodes[to];
    if (fromNode.layer === toNode.layer) continue;
    if (isAllowed(rules, fromNode.layer, toNode.layer)) continue;

    findings.push({
      kind: 'layer-violation',
      fileId: from,
      fileIds: [from, to],
      relPath: fromNode.relPath,
      layer: fromNode.layer,
      name: toNode.relPath,
      confidence: 'high',
      reason: `\`${fromNode.layer}\` is not allowed to import from \`${toNode.layer}\` (imports ${toNode.relPath}).`,
      recommendation: RECOMMENDATION,
    });
  }

  findings.sort((a, b) => a.relPath.localeCompare(b.relPath) || a.name.localeCompare(b.name));
  return findings;
}
