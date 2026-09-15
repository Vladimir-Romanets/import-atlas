import type { Finding, FindingConfidence, ScanResult } from '../types';

/**
 * Names asked of a file, or `'*'` when some importer asked for the module as
 * a whole (a namespace/dynamic import, a `require()`, an `export * from`).
 * Once a file is `'*'`, nothing it exports can be called unimported, so it
 * is skipped entirely.
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
 * Entries are seeded as `'*'`: nothing inside the scan imports an entry, so
 * its exports would all look unimported when in truth they serve whatever
 * lies outside (a bundler, a test runner, a consumer of the package).
 *
 * `export * from './x'` needs no special handling — the scan records it as
 * an edge with `names: '*'`, marking x unknowable. Blunt but safe:
 * sharpening it would first need `export * from` told apart from
 * `export * as NS from`, and both parse to the same wildcard edge today.
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
 * Every export nothing asks for, ranked by how far the import graph alone
 * justifies the claim.
 *
 * Unlike the tree's node pruning, this does NOT switch off when
 * `coverageGaps` is non-empty. A gap means some importer went unread, so a
 * name it requests looks unimported here — but a list is advisory and
 * reviewable in a way a silently missing node is not, and the viewer prints
 * the caveat above it.
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
    // NUL separates the halves of the key: a path can hold any printable
    // character an export name can, so a visible delimiter is ambiguous.
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
    // Never parsed: an empty export list means "unknown" here, not
    // "exports nothing".
    if (!facts) continue;
    // `export = ...` replaces the whole module shape, so its named exports
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

/**
 * Orders several detectors' findings into the one list the viewer renders,
 * most trustworthy first: what a reader can act on unchecked should not sit
 * below what needs a second opinion. Each detector's own row order survives
 * within a confidence level, `sort` being stable.
 *
 * It has to be a sort of the merged list. Concatenating already-sorted
 * lists leaves an appended `high` detector below every hedged row of one
 * that emits `high` through `low`.
 */
export function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => RANK[a.confidence] - RANK[b.confidence]);
}
