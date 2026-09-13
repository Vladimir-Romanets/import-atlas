import type { Finding, ScanResult } from "./types";

const RECOMMENDATION =
  "Break the cycle by extracting the shared code both sides depend on into a new module, or by importing lazily/dynamically on one side instead of at module scope.";

/**
 * Tarjan's strongly-connected-components algorithm over the whole import
 * graph. Every node ends up in exactly one component; a component of size
 * 1 is only a cycle if its node has a self-edge (checked separately by the
 * caller) — everything else is just an ordinary acyclic node.
 */
function stronglyConnectedComponents(
  nodeIds: string[],
  adjacency: Record<string, string[]>,
): string[][] {
  let nextIndex = 0;
  const index: Record<string, number> = {};
  const lowlink: Record<string, number> = {};
  const onStack: Record<string, boolean> = {};
  const stack: string[] = [];
  const components: string[][] = [];

  function strongconnect(v: string): void {
    index[v] = nextIndex;
    lowlink[v] = nextIndex;
    nextIndex++;
    stack.push(v);
    onStack[v] = true;

    for (const w of adjacency[v] || []) {
      if (index[w] === undefined) {
        strongconnect(w);
        lowlink[v] = Math.min(lowlink[v], lowlink[w]);
      } else if (onStack[w]) {
        lowlink[v] = Math.min(lowlink[v], index[w]);
      }
    }

    if (lowlink[v] === index[v]) {
      const component: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack[w] = false;
        component.push(w);
      } while (w !== v);
      components.push(component);
    }
  }

  for (const id of nodeIds) {
    if (index[id] === undefined) strongconnect(id);
  }
  return components;
}

/**
 * Finds the shortest cycle that passes through `anchor`, walking only edges
 * whose target is also in `memberSet` — that restriction is what guarantees
 * a path back to the anchor exists at all, since a strongly connected
 * component is only strongly connected through its own edges. A
 * breadth-first search visits nodes in non-decreasing distance from the
 * anchor, so the first edge back to it that turns up closes the shortest
 * possible cycle — which also lets the search stop right there instead of
 * touching the rest of a large component. Self-edges are skipped: a
 * component only reaches this function at size 2 or more, where strong
 * connectivity is already carried by edges between distinct members, so a
 * self-loop on the anchor is never needed to close the cycle and must not
 * be allowed to short-circuit the search into reporting just [anchor,
 * anchor]. Not guaranteed to visit every member for components larger than
 * the cycle it returns — the recommendation and help text call that out
 * explicitly rather than implying the walk is exhaustive.
 */
function representativeCycle(
  anchor: string,
  memberSet: Set<string>,
  adjacency: Record<string, string[]>,
): string[] {
  const predecessor = new Map<string, string>();
  const visited = new Set([anchor]);
  const queue: string[] = [anchor];

  for (let i = 0; i < queue.length; i++) {
    const v = queue[i];
    for (const w of adjacency[v] || []) {
      if (!memberSet.has(w) || w === v) continue;
      if (w === anchor) {
        const chain = [v];
        let cur = v;
        while (cur !== anchor) {
          cur = predecessor.get(cur)!;
          chain.push(cur);
        }
        chain.reverse();
        chain.push(anchor);
        return chain;
      }
      if (!visited.has(w)) {
        visited.add(w);
        predecessor.set(w, v);
        queue.push(w);
      }
    }
  }

  return [anchor, anchor];
}

export function computeCircularImports(scanResult: ScanResult): Finding[] {
  const nodeIds = Object.keys(scanResult.nodes);
  // Deferred edges are left out on purpose. The hazard this rule reports is
  // load order — a module reading a binding from one that is still
  // evaluating — and an import that only runs when a function is called
  // can't create it. Including them would flag loops that are already
  // broken, under a recommendation ("import lazily on one side") whose fix
  // is the very thing that was flagged.
  const eagerEdges = scanResult.edges.filter((edge) => !edge.isDeferred);
  const adjacency: Record<string, string[]> = {};
  for (const edge of eagerEdges) {
    (adjacency[edge.from] ||= []).push(edge.to);
  }

  const components = stronglyConnectedComponents(nodeIds, adjacency);
  const findings: Finding[] = [];
  const selfLoopIds = new Set(
    eagerEdges.filter((e) => e.from === e.to).map((e) => e.from),
  );

  for (const component of components) {
    if (component.length < 2) continue;

    const memberSet = new Set(component);
    const anchor = [...component].sort((a, b) =>
      scanResult.nodes[a].relPath.localeCompare(scanResult.nodes[b].relPath),
    )[0];
    const componentAdjacency: Record<string, string[]> = {};
    for (const id of component) {
      componentAdjacency[id] = (adjacency[id] || []).filter((to) => memberSet.has(to));
    }
    const path = representativeCycle(anchor, memberSet, componentAdjacency);

    const file = scanResult.nodes[anchor];
    findings.push({
      kind: "circular-import",
      fileId: anchor,
      // The row is filed under one anchor, but every member is implicated —
      // and the representative path doesn't necessarily name them all.
      fileIds: [...component],
      relPath: path.map((id) => scanResult.nodes[id].relPath).join(" → "),
      layer: file.layer,
      name: `${component.length} files`,
      confidence: "high",
      reason: `These ${component.length} files import each other in a cycle; the path above is the shortest cycle through ${file.relPath}, not necessarily every file in the group.`,
      recommendation: RECOMMENDATION,
    });

    for (const id of component) selfLoopIds.delete(id);
  }

  for (const id of selfLoopIds) {
    const file = scanResult.nodes[id];
    findings.push({
      kind: "circular-import",
      fileId: id,
      relPath: `${file.relPath} → ${file.relPath}`,
      layer: file.layer,
      name: "self-import",
      confidence: "high",
      reason: "This file imports itself, directly or through a re-export chain.",
      recommendation: RECOMMENDATION,
    });
  }

  findings.sort((a, b) => a.relPath.localeCompare(b.relPath));
  return findings;
}
