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
 * Turns the full (possibly cyclic, multi-parent) import graph into one tree
 * per entry point. The first time a file is reached it is expanded in full;
 * every later occurrence becomes a compact reference (`ref` set to the
 * renderId of that first occurrence) instead of re-expanding its subtree —
 * otherwise a handful of widely-imported files would blow the tree up
 * combinatorially. A back-edge to a file still on the current path is
 * flagged as a circular import instead.
 */
export function buildForest(scanResult: ScanResult): TreeNode[] {
  const childrenOf: Record<string, string[]> = {};
  // Name(s) one specific parent->child edge exposes to the parent's own
  // consumers (key: `${from} ${to}`) — surfaced per-occurrence as
  // `TreeNode.importedAs`, the viewer's primary label for that node.
  const edgeNames: Record<string, string[] | '*'> = {};
  for (const edge of scanResult.edges) {
    (childrenOf[edge.from] ||= []).push(edge.to);
    const key = `${edge.from} ${edge.to}`;
    edgeNames[key] = unionNames(edgeNames[key], edge.exposedNames);
  }

  const canonicalRenderId: Record<string, string> = {};
  // The node object holding a file's real (non-ref) children, built once
  // per file the first time the walk reaches it.
  const nodeOf: Record<string, TreeNode> = {};
  const addedChildrenOf: Record<string, Set<string>> = {};
  const onStack = new Set<string>();
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
    const key = parentId !== null ? `${parentId} ${fileId}` : "";
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
      importedAs: parentId !== null ? (edgeNames[key] ?? '*') : '*',
      fanIn: scanResult.fanIn[fileId] || 0,
      children: [],
    };
  }

  /**
   * Returns the one real (non-ref) node for `fileId`, creating it on first
   * call and reusing it forever after. Creating it is what claims the file's
   * canonical position: from then on every other edge into the file resolves
   * to a `ref` pointing at this `renderId` instead of a second expansion.
   */
  function ensureNode(fileId: string, parentId: string | null): TreeNode {
    const existing = nodeOf[fileId];
    if (existing) return existing;

    const renderId = nextRenderId();
    canonicalRenderId[fileId] = renderId;
    const childIds = childrenOf[fileId] || [];
    const hint = summarizeDupeImports(
      childIds,
      (id) => scanResult.nodes[id]?.label ?? id,
    );
    const node = makeNode(fileId, renderId, null, "", hint, parentId);
    nodeOf[fileId] = node;
    addedChildrenOf[fileId] = new Set<string>();
    return node;
  }

  /** Depth-first expansion of `fileId`'s subtree, in the order its imports appear. */
  function visit(fileId: string, parentId: string | null): TreeNode {
    const node = ensureNode(fileId, parentId);
    const added = addedChildrenOf[fileId];

    onStack.add(fileId);
    for (const childId of childrenOf[fileId] || []) {
      // The same pair can be linked by several statements (a value import
      // plus a type-only one, say). They are one child node, with the
      // repetition called out in the parent's `hint`.
      if (added.has(childId)) continue;
      added.add(childId);

      const existingRenderId = canonicalRenderId[childId];
      if (existingRenderId !== undefined) {
        const warn = onStack.has(childId) ? "circular import" : "";
        node.children.push(
          makeNode(childId, nextRenderId(), existingRenderId, warn, "", fileId),
        );
        continue;
      }
      node.children.push(visit(childId, fileId));
    }
    onStack.delete(fileId);
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
  const roots = entryIds.map((id) => ensureNode(id, null));
  for (const id of entryIds) visit(id, null);
  return roots;
}
