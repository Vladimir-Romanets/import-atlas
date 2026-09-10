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
  // Union of names ever requested of a file (its own export names), across every edge that points at it.
  const requestedNames: Record<string, string[] | '*'> = {};
  // True when at least one edge for a pair is a plain `import` (not a re-export) —
  // that's unconditional, direct usage and must never be treated as unused, no
  // matter what name the importing file is itself known by elsewhere.
  const hasPlainImportEdge: Record<string, boolean> = {};
  for (const edge of scanResult.edges) {
    (childrenOf[edge.from] ||= []).push(edge.to);
    const key = `${edge.from} ${edge.to}`;
    edgeNames[key] = unionNames(edgeNames[key], edge.exposedNames);
    requestedNames[edge.to] = unionNames(requestedNames[edge.to], edge.names);
    if (!edge.isReexport) hasPlainImportEdge[key] = true;
  }

  // "Never requested anywhere" is only a safe reading of `requestedNames`
  // when the walk actually read every consumer it could reach. If it admits
  // it dropped edges (the --max-files cap, an unparseable file, a specifier
  // that wouldn't resolve), the file requesting a name may be exactly one of
  // the ones it never read — and a wrong "unused" here reads as dead code,
  // inviting someone to delete a live re-export. So flag nothing at all.
  // Files skipped via --exclude don't count: that omission was requested.
  const canFlagUnused = scanResult.coverageGaps.length === 0;

  /**
   * True when the edge `fileId -> childId` is a re-export (`export ... from`,
   * i.e. `fileId` is a barrel forwarding `childId`'s name onward) and that
   * name was never requested anywhere else in the graph. A plain `import`
   * edge is always direct, real usage and is never flagged, regardless of
   * what name `fileId` is itself imported as by its own consumers.
   */
  function isUnusedOccurrence(fileId: string, childId: string): boolean {
    if (!canFlagUnused) return false;
    const key = `${fileId} ${childId}`;
    if (hasPlainImportEdge[key]) return false;
    const names = edgeNames[key];
    if (names === '*') return false;
    const requested = requestedNames[fileId];
    if (requested === undefined || requested === '*') return false;
    return !names.some((n) => requested.includes(n));
  }

  const canonicalRenderId: Record<string, string> = {};
  // The node object actually holding a file's real (non-ref) children —
  // built exactly once per file, then reused and mutated in place by
  // whichever pass finishes it. Whichever parent triggers that first real
  // build is recorded in `canonicalParentOf`, so the second pass knows
  // which of a file's several parents (if any) still needs revisiting to
  // attach children that were deferred during the first pass.
  const nodeOf: Record<string, TreeNode> = {};
  const addedChildrenOf: Record<string, Set<string>> = {};
  const canonicalParentOf: Record<string, string> = {};
  const onStack = new Set<string>();
  let uid = 0;
  const nextRenderId = () => `r${uid++}`;

  function makeNode(
    fileId: string,
    renderId: string,
    ref: string | null,
    warn: string,
    hint: string = "",
    unused: boolean = false,
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
      unused,
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
    const node = makeNode(fileId, renderId, null, "", hint, false, parentId);
    nodeOf[fileId] = node;
    addedChildrenOf[fileId] = new Set<string>();
    return node;
  }

  /**
   * Builds (or completes) the tree rooted at `fileId`. Called twice per
   * reachable file: once with `allowUnusedDescend: false` (a "clean-only"
   * pass that never follows an edge whose OWN occurrence is unused, so it
   * only ever builds subtrees along edges that individually requested what
   * they reach), and once with `true` (a normal pass that follows every
   * edge). A file's real node is created on whichever call reaches it first
   * and reused — same object — on every later call, so the second pass
   * mutates the exact node already sitting in the first pass's tree rather
   * than building a disconnected copy.
   *
   * Why two passes: a file reachable from more than one parent keeps a
   * single canonical (fully expanded) position, and every other place it's
   * reached from becomes a compact `ref`. If that position were simply
   * "wherever visited first" in one plain DFS, a shared file's canonical
   * copy could end up nested several levels inside some OTHER, unrelated
   * parent's unused-edge subtree — and `buildLayout` prunes an unused
   * node's subtree wholesale without descending into it, so with "hide
   * unused" on the file would vanish entirely, even though some OTHER edge
   * into it is perfectly valid, and the `ref` at that valid edge would
   * point at a node no longer in the layout. Running the clean-only pass
   * first over the *entire* forest, before any unused edge is followed at
   * all, guarantees that whenever a file has any all-valid path from an
   * entry, that's where its canonical copy lands — so the canonical
   * occurrence's own `unused` is false whenever ANY parent anywhere
   * validly requests the file, even though other occurrences of the same
   * file (under parents that don't) still get `unused: true` individually.
   */
  function visit(fileId: string, parentId: string | null, allowUnusedDescend: boolean): TreeNode {
    const node = ensureNode(fileId, parentId);
    const added = addedChildrenOf[fileId];

    onStack.add(fileId);
    const childIds = childrenOf[fileId] || [];
    for (const childId of childIds) {
      const unused = isUnusedOccurrence(fileId, childId);
      if (!allowUnusedDescend && unused) continue; // deferred to the second pass

      if (!added.has(childId)) {
        added.add(childId);
        const existingRenderId = canonicalRenderId[childId];
        if (existingRenderId !== undefined) {
          const warn = onStack.has(childId) ? "circular import" : "";
          node.children.push(
            makeNode(childId, nextRenderId(), existingRenderId, warn, "", unused, fileId),
          );
          continue;
        }
        canonicalParentOf[childId] = fileId;
        const childNode = visit(childId, fileId, allowUnusedDescend);
        childNode.unused = unused;
        node.children.push(childNode);
      } else if (allowUnusedDescend && canonicalParentOf[childId] === fileId) {
        // Already linked here as the real (non-ref) node during the
        // clean-only pass — revisit now that unused edges are allowed, to
        // attach any children that were deferred back then.
        visit(childId, fileId, true);
      }
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
  for (const id of entryIds) visit(id, null, false);
  for (const id of entryIds) visit(id, null, true);
  return roots;
}
