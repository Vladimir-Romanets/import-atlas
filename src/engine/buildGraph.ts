import { edgeKey } from "../utils/edgeKey";
import { unionNames } from "../utils/importNames";
import { summarizeExternals } from "../utils/summarize";
import type { GraphData, GraphEdge, GraphNode, ScanResult } from "../types";

/**
 * Turns the scanned import graph into the graph view: one node per file,
 * one edge per pair of files.
 *
 * The counterpart to `buildForest`, making the opposite trade. The forest
 * answers "what does THIS entry pull in, in order?" and pays by drawing a
 * shared file once per place that reaches it, leaving twelve branches
 * ending at one barrel to be reconstructed from twelve identical boxes.
 * Here the barrel is one box with twelve edges arriving; what is given up
 * is the tree's "every node has one parent" reading.
 *
 * Nothing is narrowed on the way in: a barrel keeps every re-export as a
 * child, since one node serves all its importers at once. Which of them any
 * importer reaches is carried on the edges, in `names`/`exposedNames`, for
 * the viewer to highlight rather than hide.
 */
export function buildGraph(scanResult: ScanResult): GraphData {
  const { nodes: files } = scanResult;
  const isKnown = (id: string): boolean => files[id] !== undefined;

  // ---------------------------------------------------------------------
  // 1. Collapse every statement linking the same pair into one drawn edge.
  // ---------------------------------------------------------------------
  const edges: GraphEdge[] = [];
  const edgeByKey = new Map<string, GraphEdge>();

  for (const raw of scanResult.edges) {
    // `scan` already drops edges whose target never became a node (the
    // --max-files cap can cut a walk mid-flight); covering the source too
    // makes every endpoint below a real file.
    if (!isKnown(raw.from) || !isKnown(raw.to)) continue;

    const key = edgeKey(raw.from, raw.to);
    const existing = edgeByKey.get(key);
    if (existing === undefined) {
      const edge: GraphEdge = {
        from: raw.from,
        to: raw.to,
        names: raw.names === "*" ? "*" : [...raw.names],
        exposedNames: raw.exposedNames === "*" ? "*" : [...raw.exposedNames],
        isReexport: raw.isReexport,
        isDeferred: raw.isDeferred,
        statements: 1,
        mergeableStatements: raw.isDeferred ? 0 : 1,
        // The one cycle needing no search to find — and no layering can
        // put a file left of itself.
        isBackEdge: raw.from === raw.to,
      };
      edgeByKey.set(key, edge);
      edges.push(edge);
      continue;
    }

    existing.names = unionNames(existing.names, raw.names);
    existing.exposedNames = unionNames(existing.exposedNames, raw.exposedNames);
    // One re-export among the statements makes the pair a re-export link;
    // one module-scope import among them makes the dependency load-bearing.
    existing.isReexport = existing.isReexport || raw.isReexport;
    existing.isDeferred = existing.isDeferred && raw.isDeferred;
    existing.statements += 1;
    // Counted as `computeDupeImports` counts, so the viewer's warning and
    // the Findings row it points at can't disagree.
    if (!raw.isDeferred) existing.mergeableStatements += 1;
  }

  const outEdges = new Map<string, GraphEdge[]>();
  for (const id of Object.keys(files)) outEdges.set(id, []);
  for (const edge of edges) {
    // Already marked, and would only send the walk below back into the
    // node it is standing on.
    if (edge.from === edge.to) continue;
    outEdges.get(edge.from)!.push(edge);
  }

  // ---------------------------------------------------------------------
  // 2. Find the edges that close cycles, so what's left can be layered.
  //
  // Depth-first from the entries, marking every edge landing on a node
  // still open on the current path: a cycle holds at least one such edge,
  // so cutting them all leaves an acyclic graph and cuts nothing else — an
  // edge to a finished node can't close a loop. Iterative, because the
  // deepest import chain is a poor thing to bet the call stack on.
  // ---------------------------------------------------------------------
  const UNVISITED = 0;
  const OPEN = 1;
  const DONE = 2;
  const state = new Map<string, number>();
  const order = new Map<string, number>();
  let nextOrder = 0;

  interface Frame {
    id: string;
    edges: GraphEdge[];
    next: number;
  }

  const walkFrom = (rootId: string): void => {
    const stack: Frame[] = [];
    const open = (id: string): void => {
      state.set(id, OPEN);
      order.set(id, nextOrder++);
      stack.push({ id, edges: outEdges.get(id) ?? [], next: 0 });
    };

    open(rootId);
    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      if (frame.next >= frame.edges.length) {
        state.set(frame.id, DONE);
        stack.pop();
        continue;
      }
      const edge = frame.edges[frame.next++];
      const targetState = state.get(edge.to) ?? UNVISITED;
      if (targetState === OPEN) {
        edge.isBackEdge = true;
        continue;
      }
      if (targetState === DONE) continue;
      open(edge.to);
    }
  };

  const entries = scanResult.entries.filter(isKnown);
  for (const id of entries) {
    if ((state.get(id) ?? UNVISITED) === UNVISITED) walkFrom(id);
  }
  // A safety net: every recorded file was reached from an entry, but a node
  // the walk never opened would carry no discovery order and sort
  // unpredictably.
  for (const id of Object.keys(files)) {
    if ((state.get(id) ?? UNVISITED) === UNVISITED) walkFrom(id);
  }

  // ---------------------------------------------------------------------
  // 3. Depth: the longest path from a node with nothing pointing at it.
  //    Kahn's topological order over the forward edges only, relaxing each
  //    target to `max(its own depth, source + 1)` as it is passed.
  // ---------------------------------------------------------------------
  const depth = new Map<string, number>();
  const pendingIn = new Map<string, number>();
  for (const id of Object.keys(files)) {
    depth.set(id, 0);
    pendingIn.set(id, 0);
  }
  for (const edge of edges) {
    if (edge.isBackEdge) continue;
    pendingIn.set(edge.to, (pendingIn.get(edge.to) ?? 0) + 1);
  }

  const byDiscovery = (a: string, b: string): number =>
    (order.get(a) ?? 0) - (order.get(b) ?? 0);
  const ready = Object.keys(files)
    .filter((id) => (pendingIn.get(id) ?? 0) === 0)
    .sort(byDiscovery);

  // Index cursor rather than `shift()`: the queue holds every file in the
  // project, and shifting an array that size is quadratic.
  for (let i = 0; i < ready.length; i++) {
    const id = ready[i];
    const from = depth.get(id) ?? 0;
    for (const edge of outEdges.get(id) ?? []) {
      if (edge.isBackEdge) continue;
      if ((depth.get(edge.to) ?? 0) < from + 1) depth.set(edge.to, from + 1);
      const left = (pendingIn.get(edge.to) ?? 0) - 1;
      pendingIn.set(edge.to, left);
      if (left === 0) ready.push(edge.to);
    }
  }

  // ---------------------------------------------------------------------
  // 4. Assemble.
  // ---------------------------------------------------------------------
  const importers = new Map<string, number>();
  for (const edge of edges) {
    if (edge.from === edge.to) continue;
    importers.set(edge.to, (importers.get(edge.to) ?? 0) + 1);
  }

  const entrySet = new Set(entries);
  const graphNodes: GraphNode[] = Object.keys(files).map((id) => {
    const file = files[id];
    return {
      id,
      label: file.label,
      relPath: file.relPath,
      layer: file.layer,
      note: summarizeExternals(file.externalImports),
      fanIn: importers.get(id) ?? 0,
      fanOut: (outEdges.get(id) ?? []).length,
      depth: depth.get(id) ?? 0,
      isEntry: entrySet.has(id),
      order: order.get(id) ?? 0,
    };
  });

  // Shallowest first, discovery order among equals — the sequence the
  // layout starts from before it sorts rows to untangle edges.
  graphNodes.sort((a, b) => a.depth - b.depth || a.order - b.order);

  let maxDepth = 0;
  for (const node of graphNodes) {
    if (node.depth > maxDepth) maxDepth = node.depth;
  }

  return { nodes: graphNodes, edges, entries, maxDepth };
}
