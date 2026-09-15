import { edgeKey } from "../utils/edgeKey";
import { unionNames } from "../utils/importNames";
import { summarizeExternals } from "../utils/summarize";
import type { ScanResult, TreeNode } from "../types";

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
  // Whether a pair is reached only lazily. A pair linked by several
  // statements counts as lazy only when every one of them is: one plain
  // `import` alongside a dynamic one still loads the file eagerly, and
  // drawing that link as deferred would say the opposite of the truth.
  const edgeDeferred: Record<string, boolean> = {};

  for (const edge of scanResult.edges) {
    (childrenOf[edge.from] ||= []).push(edge.to);
    const key = edgeKey(edge.from, edge.to);
    edgeExposes[key] = unionNames(edgeExposes[key], edge.exposedNames);
    edgeRequests[key] = unionNames(edgeRequests[key], edge.names);
    edgeDeferred[key] = (edgeDeferred[key] ?? true) && edge.isDeferred;
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
    // of it by name — and nothing deferred it, either.
    const parentKey = parentId !== null ? edgeKey(parentId, fileId) : null;
    const exposes = parentKey !== null ? edgeExposes[parentKey] : undefined;
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
      isDeferred: parentKey !== null ? (edgeDeferred[parentKey] ?? false) : false,
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

  /**
   * Depth-first expansion of one occurrence, in the order its imports
   * appear.
   *
   * Written with an explicit stack rather than recursion, since a real
   * project's longest import chain is a poor thing to bet the call stack
   * on. What lets a frame per occurrence stand in
   * for a call frame: `ensureNode` returns the same `TreeNode` object every
   * time it is asked for a given key, so a child can be pushed into its
   * parent's `children` array the moment the walk reaches it — before that
   * child's own subtree is expanded — and the array still ends up holding
   * the fully-expanded node once the child's frame is done, because it is
   * the same object being mutated in place, not a fresh one returned
   * later. That is what a recursive `node.children.push(visit(...))` got
   * for free from evaluation order.
   *
   * The one thing recursion would otherwise still be trusted to do
   * correctly is `openKeyOf.delete(fileId)`, which has to run exactly when
   * a frame's children are exhausted — that boundary is what separates "on
   * the path currently being walked" (a circular-import marker) from
   * "already finished" (an ordinary reference). Here it happens in the one
   * place a frame is popped, so it can't be skipped or duplicated.
   */
  function visit(fileId: string, request: Request, parentId: string | null): void {
    interface Frame {
      fileId: string;
      request: Request;
      node: TreeNode;
      childIds: string[];
      added: Set<string>;
      next: number;
    }
    const stack: Frame[] = [];

    const push = (fileId: string, request: Request, parentId: string | null): TreeNode => {
      const key = keyOf(fileId, request);
      const node = ensureNode(fileId, key, request, parentId);
      openKeyOf.set(fileId, key);
      stack.push({
        fileId,
        request,
        node,
        childIds: childrenOf[fileId] || [],
        added: addedChildrenOf[key],
        next: 0,
      });
      return node;
    };

    push(fileId, request, parentId);

    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      if (frame.next >= frame.childIds.length) {
        openKeyOf.delete(frame.fileId);
        stack.pop();
        continue;
      }

      const childId = frame.childIds[frame.next++];
      // The same pair can be linked by several statements (a value import
      // plus a type-only one, say). They are one child node, with the
      // repetition called out in this node's `hint`.
      if (frame.added.has(childId)) continue;
      frame.added.add(childId);
      if (!requestReaches(frame.fileId, childId, frame.request)) continue;

      const childRequest = edgeRequests[edgeKey(frame.fileId, childId)] ?? '*';

      // Closing a loop: point back at the occurrence still being expanded
      // rather than descending into it again.
      const openKey = openKeyOf.get(childId);
      if (openKey !== undefined) {
        frame.node.children.push(
          makeNode(
            childId,
            nextRenderId(),
            canonicalRenderId[openKey],
            "circular import — see Findings tab for the full cycle",
            "",
            frame.fileId,
          ),
        );
        continue;
      }

      const existingRenderId = canonicalRenderId[keyOf(childId, childRequest)];
      if (existingRenderId !== undefined) {
        frame.node.children.push(
          makeNode(childId, nextRenderId(), existingRenderId, "", "", frame.fileId),
        );
        continue;
      }

      // Descend: claim the child's canonical position and its slot in this
      // node's children now, then push a frame to expand it. `childNode`
      // is the same object `frame.node.children` now holds, so filling in
      // its own children later (as its frame runs) is all this slot needs.
      const childNode = push(childId, childRequest, frame.fileId);
      frame.node.children.push(childNode);
    }
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
