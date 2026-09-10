import type { Finding, FindingConfidence, ScanResult } from './types';

/**
 * Names some importer asked of a file, or `'*'` when one of them asked for
 * the module as a whole — a namespace import, a dynamic `import()`, a
 * `require()`, or an `export * from` chain whose own consumers can't be
 * pinned down. Once a file is `'*'`, nothing it exports can be called
 * unimported, so it is skipped entirely.
 */
type RequestedNames = Set<string> | '*';

const RANK: Record<FindingConfidence, number> = { high: 0, medium: 1, low: 2 };

function addRequested(
  table: Record<string, RequestedNames>,
  fileId: string,
  names: string[] | '*',
): void {
  if (table[fileId] === '*') return;
  if (names === '*') {
    table[fileId] = '*';
    return;
  }
  const current = table[fileId];
  const set = current instanceof Set ? current : (table[fileId] = new Set<string>());
  for (const name of names) set.add(name);
}

/**
 * What every file in the graph has been asked for, by name.
 *
 * Entry points are seeded as `'*'`: nothing inside the scan imports an
 * entry, so its exports would all look unimported, when in truth they serve
 * whatever lies outside the scan (a bundler, a test runner, a consumer of
 * the package).
 *
 * `export * from './x'` needs no special handling: the scan already records
 * it as an edge carrying `names: '*'`, which marks x unknowable — blunt but
 * safe. Sharpening it (crediting x only with what the barrel itself is
 * asked for) would first need `export * from` told apart from
 * `export * as NS from`, which really does hand consumers the whole module;
 * both parse to the same wildcard edge today.
 */
function buildRequestedTable(scanResult: ScanResult): Record<string, RequestedNames> {
  const requested: Record<string, RequestedNames> = {};
  for (const entryId of scanResult.entries) requested[entryId] = '*';
  for (const edge of scanResult.edges) addRequested(requested, edge.to, edge.names);
  return requested;
}

const RECOMMENDATION: Record<FindingConfidence, string> = {
  high: "Drop the `export` keyword if the symbol is only used inside this file — or remove the symbol itself if it isn't used at all.",
  medium:
    'Only the default export is imported. The named export looks redundant: remove it, or move consumers onto it and drop the default.',
  low: 'Verify before removing — the symbol is most likely reached through the default export, which the import graph cannot follow.',
};

const REEXPORT_RECOMMENDATION =
  'Nothing imports this name from the barrel. Remove the re-export line — the file it points at stays reachable through its own path.';

/**
 * Every export in the scanned graph that nothing asks for, ranked by how
 * much the import graph alone can justify the claim.
 *
 * Unlike the tree's node pruning, this does NOT switch itself off when
 * `coverageGaps` is non-empty. A gap means some importer went unread, so a
 * name it requests would look unimported here — but a list is advisory and
 * reviewable in a way that a silently missing node is not. The viewer
 * carries the caveat above the list instead, so the reader can weigh it.
 */
export function computeFindings(scanResult: ScanResult): Finding[] {
  const requested = buildRequestedTable(scanResult);
  const findings: Finding[] = [];
  const seen = new Set<string>();

  const push = (
    kind: Finding['kind'],
    fileId: string,
    name: string,
    confidence: FindingConfidence,
    reason: string,
    recommendation: string,
  ): void => {
    // A file reports each name once, however many statements export it.
    // NUL separates the two halves of the key because a path may contain
    // any printable character an export name can, so a visible delimiter
    // could in principle belong to either side.
    const key = `${fileId}\u0000${name}`;
    if (seen.has(key)) return;
    seen.add(key);
    const file = scanResult.nodes[fileId];
    findings.push({
      kind,
      fileId,
      relPath: file.relPath,
      layer: file.layer,
      name,
      confidence,
      reason,
      recommendation,
    });
  };

  for (const fileId of Object.keys(scanResult.nodes)) {
    const facts = scanResult.nodes[fileId].exports;
    // Never parsed (an asset, or a file that wouldn't read) — an empty
    // export list here means "unknown", not "exports nothing".
    if (!facts) continue;
    // `export = ...` replaces the whole module shape; its named exports
    // can't be matched against what importers ask for.
    if (facts.hasExportEquals) continue;

    const asked = requested[fileId];
    if (asked === undefined || asked === '*') continue;

    const defaultIsUsed = asked.has('default');
    for (const name of facts.ownNames) {
      if (asked.has(name)) continue;

      let confidence: FindingConfidence = 'high';
      let reason = 'No file in the scan imports this name.';
      if (defaultIsUsed && facts.defaultAggregateNames.includes(name)) {
        confidence = 'low';
        reason =
          "Listed as a property of the object this file default-exports, which IS imported — consumers most likely reach it as `Default.name`, an access the import graph can't see.";
      } else if (defaultIsUsed && name === facts.defaultLocalName) {
        confidence = 'medium';
        reason =
          'Exported both by name and as this file\'s default, and only the default is ever imported.';
      }
      push('dead-export', fileId, name, confidence, reason, RECOMMENDATION[confidence]);
    }
  }

  for (const edge of scanResult.edges) {
    if (!edge.isReexport || edge.exposedNames === '*') continue;
    const asked = requested[edge.from];
    if (asked === undefined || asked === '*') continue;
    for (const name of edge.exposedNames) {
      if (asked.has(name)) continue;
      push(
        'dead-reexport',
        edge.from,
        name,
        'high',
        'This barrel forwards the name, but nothing imports it from here.',
        REEXPORT_RECOMMENDATION,
      );
    }
  }

  findings.sort(
    (a, b) =>
      RANK[a.confidence] - RANK[b.confidence] ||
      a.relPath.localeCompare(b.relPath) ||
      a.name.localeCompare(b.name),
  );
  return findings;
}
