import { edgeKey } from "./edgeKey";
import type { ScanResult, TreeNode } from "./types";

function summarizeExternals(externalImports: string[]): string {
  if (externalImports.length === 0) return "";
  const shown = externalImports.slice(0, 6).join(", ");
  return externalImports.length > 6
    ? `${shown}, +${externalImports.length - 6} more`
    : shown;
}

/**
 * Builds the "you imported this file N times" hint for a parent whose
 * children list contains repeats of the same childId (e.g. a value import
 * plus a type-only import, or two separate re-export lines from one file).
 */
function summarizeDupeImports(
  childIds: string[],
  labelOf: (id: string) => string,
): string {
  const counts: Record<string, number> = {};
  for (const id of childIds) counts[id] = (counts[id] || 0) + 1;
  const dupes = Object.entries(counts).filter(([, count]) => count > 1);

  if (dupes.length === 0) return "";
  const parts = dupes.map(([id, count]) => `${labelOf(id)} (×${count})`);

  return `Imported ${parts.length > 1 ? "multiple times" : "twice"} via separate statements: ${parts.join(", ")} — consider consolidating into a single import/export line.`;
}

function unionNames(a: string[] | '*' | undefined, b: string[] | '*'): string[] | '*' {
  if (a === '*' || b === '*') return '*';
  if (!a) return [...b];
  const set = new Set(a);
  for (const n of b) set.add(n);
  return [...set];
}

/**
 * What one occurrence's importer asked of it: the name(s) the incoming edge
 * requests. `'*'` when that can't be pinned down — a namespace import, a
 * dynamic `import()`, a `require()`, an `export * from`, or an entry point,
 * which nothing in the scan imports at all.
 */
type Request = string[] | '*';

/**
 * Turns the full (possibly cyclic, multi-parent) import graph into one tree
 * per entry point.
 *
 * A file reached from more than one place is expanded once and referenced
 * everywhere else (`ref` naming the renderId of that one expansion),
 * because expanding every occurrence in full would blow the tree up
 * combinatorially. A back-edge to a file still on the current path becomes
 * a reference flagged as a circular import (the Findings tab has the full,
 * whole-graph cycle list — this is only the first back-edge this one DFS
 * path happens to hit).
 *
 * Barrels are the exception to "expanded once". What a barrel's children
 * ARE depends on what its importer asked for: `import { Button } from
 * 'components/button'` reaches exactly one of the barrel's re-exports, and
 * showing the other twenty alongside it describes the barrel file rather
 * than the path the reader is following. So a barrel is expanded once per
 * distinct request made of it, and each occurrence carries only the
 * children that request actually reaches. Every other file still expands
 * exactly once — what it contains doesn't depend on how it was asked for.
 */
export function buildForest(scanResult: ScanResult): TreeNode[] {
  const childrenOf: Record<string, string[]> = {};
  // Keyed by `edgeKey(from, to)`. What the edge exposes onward (the viewer's
  // node label, and what a barrel offers its own consumers) and what it
  // requests of the target (which becomes that target's own request context).
  const edgeExposes: Record<string, Request> = {};
  const edgeRequests: Record<string, Request> = {};
  // A pair linked by at least one plain `import` is unconditional usage by
  // the importing file itself, whatever else it may also re-export.
  const hasPlainImportEdge: Record<string, boolean> = {};
  // A file that re-exports anything: the only kind whose children depend on
  // what was asked of it.
  const isBarrel: Record<string, boolean> = {};

  for (const edge of scanResult.edges) {
    (childrenOf[edge.from] ||= []).push(edge.to);
    const key = edgeKey(edge.from, edge.to);
    edgeExposes[key] = unionNames(edgeExposes[key], edge.exposedNames);
    edgeRequests[key] = unionNames(edgeRequests[key], edge.names);
    if (edge.isReexport) isBarrel[edge.from] = true;
    else hasPlainImportEdge[key] = true;
  }

  /**
   * The identity a node is deduplicated under. For a barrel that's the file
   * plus the request that reached it, so two importers asking for different
   * names get two expansions instead of sharing one that shows the union.
   * For everything else it's just the file.
   */
  function keyOf(fileId: string, request: Request): string {
    if (!isBarrel[fileId]) return fileId;
    return `${fileId}|${request === '*' ? '*' : [...request].sort().join(',')}`;
  }

  /**
   * Whether a barrel reached by `request` actually leads to `childId`.
   *
   * Fails open in every case where the graph can't say otherwise: a request
   * that couldn't be pinned down, a wildcard re-export whose forwarded names
   * are unknown, and any pair the barrel also imports outright.
   */
  function requestReaches(fileId: string, childId: string, request: Request): boolean {
    if (!isBarrel[fileId] || request === '*') return true;
    const key = edgeKey(fileId, childId);
    if (hasPlainImportEdge[key]) return true;
    const exposed = edgeExposes[key];
    if (exposed === '*') return true;
    return exposed.some((name) => request.includes(name));
  }

  const canonicalRenderId: Record<string, string> = {};
  const nodeOf: Record<string, TreeNode> = {};
  const addedChildrenOf: Record<string, Set<string>> = {};
  // Files whose expansion is still open on the current path, mapped to the
  // key of the occurrence doing the expanding — so a back-edge can point at
  // the node it closes the loop with, even when that node is one of several
  // occurrences of the file.
  const openKeyOf = new Map<string, string>();
  let uid = 0;
  const nextRenderId = () => `r${uid++}`;

  function makeNode(
    fileId: string,
    renderId: string,
    ref: string | null,
    warn: string,
    hint: string = "",
    parentId: string | null = null,
  ): TreeNode {
    const file = scanResult.nodes[fileId];
    // A root has no incoming edge to read a label off, so nothing was asked
    // of it by name.
    const exposes =
      parentId !== null ? edgeExposes[edgeKey(parentId, fileId)] : undefined;
    return {
      renderId,
      fileId,
      label: file.label,
      relPath: file.relPath,
      layer: file.layer,
      note: summarizeExternals(file.externalImports),
      warn,
      hint,
      ref,
      importedAs: exposes ?? '*',
      fanIn: scanResult.fanIn[fileId] || 0,
      children: [],
    };
  }

  /**
   * Returns the one real (non-ref) node for `key`, creating it on first
   * call and reusing it forever after. Creating it is what claims that
   * occurrence's canonical position: from then on every other edge
   * resolving to the same key becomes a `ref` pointing at this renderId.
   */
  function ensureNode(
    fileId: string,
    key: string,
    request: Request,
    parentId: string | null,
  ): TreeNode {
    const existing = nodeOf[key];
    if (existing) return existing;

    const renderId = nextRenderId();
    canonicalRenderId[key] = renderId;
    // Only the children this occurrence actually shows can be duplicated
    // within it, so the hint is built from those.
    const childIds = (childrenOf[fileId] || []).filter((childId) =>
      requestReaches(fileId, childId, request),
    );
    const hint = summarizeDupeImports(
      childIds,
      (id) => scanResult.nodes[id]?.label ?? id,
    );
    const node = makeNode(fileId, renderId, null, "", hint, parentId);
    nodeOf[key] = node;
    addedChildrenOf[key] = new Set<string>();
    return node;
  }

  /** Depth-first expansion of one occurrence, in the order its imports appear. */
  function visit(fileId: string, request: Request, parentId: string | null): TreeNode {
    const key = keyOf(fileId, request);
    const node = ensureNode(fileId, key, request, parentId);
    const added = addedChildrenOf[key];

    openKeyOf.set(fileId, key);
    for (const childId of childrenOf[fileId] || []) {
      // The same pair can be linked by several statements (a value import
      // plus a type-only one, say). They are one child node, with the
      // repetition called out in this node's `hint`.
      if (added.has(childId)) continue;
      added.add(childId);
      if (!requestReaches(fileId, childId, request)) continue;

      const childRequest = edgeRequests[edgeKey(fileId, childId)] ?? '*';

      // Closing a loop: point back at the occurrence still being expanded
      // rather than descending into it again.
      const openKey = openKeyOf.get(childId);
      if (openKey !== undefined) {
        node.children.push(
          makeNode(
            childId,
            nextRenderId(),
            canonicalRenderId[openKey],
            "circular import — see Findings tab for the full cycle",
            "",
            fileId,
          ),
        );
        continue;
      }

      const existingRenderId = canonicalRenderId[keyOf(childId, childRequest)];
      if (existingRenderId !== undefined) {
        node.children.push(
          makeNode(childId, nextRenderId(), existingRenderId, "", "", fileId),
        );
        continue;
      }
      node.children.push(visit(childId, childRequest, fileId));
    }
    openKeyOf.delete(fileId);
    return node;
  }

  // Entry points own their canonical position: reserve a root node for each
  // one BEFORE any traversal. Otherwise an entry that some earlier entry
  // happens to import would be expanded in place as that entry's descendant,
  // and the top-level pass would then hand back the very same object as a
  // forest root too — putting one node, and its renderId, in the tree twice.
  // With the roots reserved, such a cross-entry import resolves to a compact
  // `ref` back to the imported entry's own root instead.
  const entryIds = [...new Set(scanResult.entries)];
  const roots = entryIds.map((id) => ensureNode(id, keyOf(id, '*'), '*', null));
  for (const id of entryIds) visit(id, '*', null);
  return roots;
}
