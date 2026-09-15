import { edgeKey } from "../utils/edgeKey";
import { unionNames } from "../utils/importNames";
import { summarizeExternals } from "../utils/summarize";
import type { ScanResult, TreeNode } from "../types";

/**
 * The "you imported this file N times" hint for a parent whose children list
 * repeats a childId (a value import plus a type-only one, say).
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
 * The name(s) an occurrence's incoming edge requests. `'*'` when that can't
 * be pinned down — a namespace/dynamic import, a `require()`, an
 * `export * from`, or an entry point, which nothing in the scan imports.
 */
type Request = string[] | '*';

/**
 * Turns the full (possibly cyclic, multi-parent) import graph into one tree
 * per entry point.
 *
 * A file reached from more than one place is expanded once and referenced
 * everywhere else (`ref` naming that expansion's renderId), since expanding
 * every occurrence would blow the tree up combinatorially. A back-edge to a
 * file still on the current path becomes a reference flagged as a circular
 * import — only the first back-edge this DFS path hits; the Findings tab
 * has the whole-graph cycle list.
 *
 * Barrels are the exception. What a barrel's children ARE depends on what
 * was asked of it: `import { Button } from 'components/button'` reaches one
 * re-export, and showing the other twenty describes the barrel rather than
 * the path being followed. So a barrel is expanded once per distinct
 * request, each occurrence carrying only the children that request reaches.
 */
export function buildForest(scanResult: ScanResult): TreeNode[] {
  const childrenOf: Record<string, string[]> = {};
  // Both keyed by `edgeKey(from, to)`: what the edge exposes onward (the
  // viewer's node label) and what it requests of the target (which becomes
  // that target's own request context).
  const edgeExposes: Record<string, Request> = {};
  const edgeRequests: Record<string, Request> = {};
  // One plain `import` on a pair is unconditional usage by the importing
  // file, whatever else it may also re-export.
  const hasPlainImportEdge: Record<string, boolean> = {};
  // A file that re-exports anything — the only kind whose children depend
  // on what was asked of it.
  const isBarrel: Record<string, boolean> = {};
  // Lazy only when EVERY statement linking the pair is: one plain `import`
  // beside a dynamic one still loads the file eagerly, and a dotted line
  // would say the opposite.
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
   * The identity a node is deduplicated under: the file, or — for a barrel
   * — the file plus the request that reached it, so two importers asking
   * for different names get two expansions rather than one showing both.
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
  // Files still open on the current path, mapped to the key of the
  // occurrence expanding them — so a back-edge can point at the exact node
  // it closes the loop with, of however many the file has.
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
    // A root has no incoming edge: nothing asked for it by name, and
    // nothing deferred it either.
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
   * The one real (non-ref) node for `key`, created on first call and reused
   * after. Creating it claims that occurrence's canonical position: every
   * later edge resolving to the same key becomes a `ref` to this renderId.
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
    // Only the children this occurrence shows can be duplicated within it.
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
   * Depth-first expansion of one occurrence, in import order.
   *
   * Explicit stack rather than recursion: a real project's longest import
   * chain is a poor thing to bet the call stack on. What makes a frame
   * stand in for a call frame is that `ensureNode` returns the same
   * `TreeNode` object for a given key, so a child can be pushed into its
   * parent's `children` the moment the walk reaches it and still end up
   * fully expanded — the same object, mutated in place, rather than one
   * returned later as `node.children.push(visit(...))` would have been.
   *
   * `openKeyOf.delete(fileId)` must run exactly when a frame's children run
   * out: that boundary separates "on the path being walked" (a circular-
   * import marker) from "already finished" (an ordinary reference). Here it
   * sits in the one place a frame is popped.
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
      // Several statements linking the same pair are one child node; the
      // repetition is called out in this node's `hint`.
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

      // Claim the child's canonical position and its slot here, then push
      // a frame to expand it. `childNode` is the same object the children
      // array now holds, so its frame filling it in later is enough.
      const childNode = push(childId, childRequest, frame.fileId);
      frame.node.children.push(childNode);
    }
  }

  // Reserve a root node per entry BEFORE any traversal. Otherwise an entry
  // imported by an earlier one would be expanded in place as its
  // descendant, and the top-level pass would hand back that same object as
  // a forest root too — one node, and its renderId, twice in the tree. With
  // the roots reserved, such a cross-entry import becomes a `ref` instead.
  const entryIds = [...new Set(scanResult.entries)];
  const roots = entryIds.map((id) => ensureNode(id, keyOf(id, '*'), '*', null));
  for (const id of entryIds) visit(id, '*', null);
  return roots;
}
