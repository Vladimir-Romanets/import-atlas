import type { Finding, ScanResult } from "../types";

const RECOMMENDATION =
  "Break the cycle by extracting the shared code both sides depend on into a new module, or by importing lazily/dynamically on one side instead of at module scope.";

/**
 * Longest loop reported as a row of its own.
 *
 * Four is where the list stops naming new problems and starts naming
 * combinations of ones already named. Measured on a 1574-file project whose
 * largest group is 1236 files: a limit of 4 yields 22 rows, a limit of 5
 * yields 50, and 27 of those extra 28 rows end with the same import the
 * shorter rows already point at — 19 of them are one fact ("three pages
 * import UserProfileActions, which imports six stores") multiplied out. A
 * limit of 6 yields 360 rows. Overridable per run for anyone who wants to
 * look wider.
 */
export const DEFAULT_MAX_CYCLE_LENGTH = 4;

/**
 * Most rows one strongly connected group may contribute. A group dense
 * enough to blow past this has a structural problem no list of loops
 * conveys, so the rest are counted in each row's `reason` instead of
 * printed.
 */
const MAX_ROWS_PER_GROUP = 100;

export interface CircularImportOptions {
  /** Longest loop reported as its own row. Defaults to `DEFAULT_MAX_CYCLE_LENGTH`. */
  maxCycleLength?: number;
}

/**
 * Tarjan's strongly-connected-components algorithm over the whole import
 * graph. Every node ends up in exactly one component; a component of size
 * 1 is only a cycle if its node has a self-edge (checked separately by the
 * caller) — everything else is just an ordinary acyclic node.
 *
 * Written with an explicit stack rather than recursion, since a real
 * project's longest import chain is a poor thing to bet the call stack on
 * Each frame is one call to `strongconnect` would
 * have made, holding its own cursor into `v`'s adjacency list so the walk
 * can resume it after descending into a child — the child's `lowlink` is
 * relaxed against its parent's when the child's frame is popped, which is
 * exactly when a recursive call would have returned. `buildGraph.ts` walks
 * its own graph the same way, for the same reason.
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

  interface Frame {
    v: string;
    edges: string[];
    next: number;
  }

  function strongconnect(root: string): void {
    const work: Frame[] = [];
    const open = (v: string): void => {
      index[v] = nextIndex;
      lowlink[v] = nextIndex;
      nextIndex++;
      stack.push(v);
      onStack[v] = true;
      work.push({ v, edges: adjacency[v] || [], next: 0 });
    };

    open(root);
    while (work.length > 0) {
      const frame = work[work.length - 1];
      if (frame.next >= frame.edges.length) {
        if (lowlink[frame.v] === index[frame.v]) {
          const component: string[] = [];
          let w: string;
          do {
            w = stack.pop()!;
            onStack[w] = false;
            component.push(w);
          } while (w !== frame.v);
          components.push(component);
        }
        work.pop();
        const parent = work[work.length - 1];
        if (parent) lowlink[parent.v] = Math.min(lowlink[parent.v], lowlink[frame.v]);
        continue;
      }

      const w = frame.edges[frame.next++];
      if (index[w] === undefined) {
        open(w);
      } else if (onStack[w]) {
        lowlink[frame.v] = Math.min(lowlink[frame.v], index[w]);
      }
    }
  }

  for (const id of nodeIds) {
    if (index[id] === undefined) strongconnect(id);
  }
  return components;
}

/**
 * Every elementary loop of at most `maxLen` files inside one strongly
 * connected group. An elementary loop visits no file twice, so each one is
 * a chain a reader can follow and act on by itself.
 *
 * `members` must be ordered. Each loop is emitted exactly once, from its
 * earliest member, because the walk only ever steps to members at or after
 * the one it started from. Ordering `members` by path therefore also rotates
 * every loop to start at its alphabetically first file — the file the row
 * gets filed under — so no second pass is needed to canonicalise them.
 *
 * Bounding the depth is what makes this affordable. Enumerating every
 * elementary loop is exponential in the worst case, and on a real 1236-file
 * group it finds 58,863 of them; stopping at four files finds 22 of them in
 * 4ms, and those 22 are the ones worth reading.
 */
function shortLoops(
  members: string[],
  adjacency: Record<string, string[]>,
  maxLen: number,
): string[][] {
  const rank = new Map(members.map((id, i) => [id, i]));
  const loops: string[][] = [];

  for (let start = 0; start < members.length; start++) {
    const first = members[start];
    const path = [first];
    const onPath = new Set([first]);

    const walk = (v: string): void => {
      for (const w of adjacency[v] || []) {
        // A file importing itself is its own finding, not a loop of one.
        if (w === v) continue;
        if (w === first) {
          loops.push([...path]);
          continue;
        }
        const wRank = rank.get(w);
        if (wRank === undefined || wRank < start) continue;
        if (onPath.has(w) || path.length >= maxLen) continue;
        onPath.add(w);
        path.push(w);
        walk(w);
        path.pop();
        onPath.delete(w);
      }
    };

    walk(first);
  }

  return loops;
}

/**
 * Finds the shortest cycle that passes through `anchor`, walking only edges
 * whose target is also in `memberSet` — that restriction is what guarantees
 * a path back to the anchor exists at all, since a strongly connected
 * component is only strongly connected through its own edges. A
 * breadth-first search visits nodes in non-decreasing distance from the
 * anchor, so the first edge back to it that turns up closes the shortest
 * possible cycle.
 *
 * Only reached when a group holds no loop short enough to list — a long ring
 * of files, say. Every group is guaranteed to yield one row this way, so a
 * group can never go unreported for being awkwardly shaped.
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

export function computeCircularImports(
  scanResult: ScanResult,
  options: CircularImportOptions = {},
): Finding[] {
  const maxCycleLength = Math.max(
    2,
    options.maxCycleLength ?? DEFAULT_MAX_CYCLE_LENGTH,
  );
  const relPathOf = (id: string): string => scanResult.nodes[id].relPath;
  const chainOf = (loop: string[]): string =>
    [...loop, loop[0]].map(relPathOf).join(" → ");

  const nodeIds = Object.keys(scanResult.nodes);
  // Deferred edges are left out on purpose. The hazard this rule reports is
  // load order — a module reading a binding from one that is still
  // evaluating — and an import that only runs when a function is called
  // can't create it. Including them would flag loops that are already
  // broken, under a recommendation ("import lazily on one side") whose fix
  // is the very thing that was flagged.
  const eagerEdges = scanResult.edges.filter((edge) => !edge.isDeferred);
  // Two statements importing the same module are one import in a loop, so
  // parallel edges collapse here. Left in, they would print the same loop
  // twice — a file re-exported twice from one barrel did exactly that.
  const adjacency: Record<string, string[]> = {};
  const targetsSeen = new Map<string, Set<string>>();
  for (const edge of eagerEdges) {
    let targets = targetsSeen.get(edge.from);
    if (!targets) {
      targets = new Set<string>();
      targetsSeen.set(edge.from, targets);
    }
    if (targets.has(edge.to)) continue;
    targets.add(edge.to);
    (adjacency[edge.from] ||= []).push(edge.to);
  }

  const components = stronglyConnectedComponents(nodeIds, adjacency);
  const rows: { size: number; finding: Finding }[] = [];
  const selfLoopIds = new Set(
    eagerEdges.filter((e) => e.from === e.to).map((e) => e.from),
  );

  for (const component of components) {
    if (component.length < 2) continue;

    const memberSet = new Set(component);
    const members = [...component].sort((a, b) =>
      relPathOf(a).localeCompare(relPathOf(b)),
    );
    const componentAdjacency: Record<string, string[]> = {};
    for (const id of component) {
      componentAdjacency[id] = (adjacency[id] || []).filter((to) =>
        memberSet.has(to),
      );
    }

    const loops = shortLoops(members, componentAdjacency, maxCycleLength);
    loops.sort(
      (a, b) => a.length - b.length || chainOf(a).localeCompare(chainOf(b)),
    );
    const shown = loops.slice(0, MAX_ROWS_PER_GROUP);

    if (shown.length === 0) {
      // No loop short enough to list. One row for the group, carrying the
      // shortest cycle through its alphabetically first file.
      const anchor = members[0];
      const path = representativeCycle(anchor, memberSet, componentAdjacency);
      const named = path.length - 1;
      rows.push({
        size: named,
        finding: {
          kind: "circular-import",
          fileId: anchor,
          // Nothing smaller could be named, so the row stands for the group.
          fileIds: [...component],
          relPath: path.map(relPathOf).join(" → "),
          layer: scanResult.nodes[anchor].layer,
          name: `${named} files`,
          confidence: "high",
          reason: `These ${named} files import each other in a cycle. They sit in a group of ${component.length} files that all reach each other, and no loop inside it is short enough to list on its own (${maxCycleLength} files or fewer), so this is the shortest cycle through ${relPathOf(anchor)} instead.`,
          recommendation: RECOMMENDATION,
        },
      });
    } else {
      for (const loop of shown) {
        rows.push({
          size: loop.length,
          finding: {
            kind: "circular-import",
            fileId: loop[0],
            // Exactly the files named on this row — the row is one loop, not
            // the whole group it was found in.
            fileIds: [...loop],
            relPath: chainOf(loop),
            layer: scanResult.nodes[loop[0]].layer,
            name: `${loop.length} files`,
            confidence: "high",
            reason: loopReason(
              loop.length,
              component.length,
              loops.length,
              shown.length,
              maxCycleLength,
            ),
            recommendation: RECOMMENDATION,
          },
        });
      }
    }

    for (const id of component) selfLoopIds.delete(id);
  }

  for (const id of selfLoopIds) {
    const file = scanResult.nodes[id];
    rows.push({
      size: 1,
      finding: {
        kind: "circular-import",
        fileId: id,
        relPath: `${file.relPath} → ${file.relPath}`,
        layer: file.layer,
        name: "self-import",
        confidence: "high",
        reason:
          "This file imports itself, directly or through a re-export chain.",
        recommendation: RECOMMENDATION,
      },
    });
  }

  // Tightest loops first: a two-file loop is both the easiest to understand
  // and the easiest to fix, so it should not be buried under longer ones.
  rows.sort(
    (a, b) =>
      a.size - b.size || a.finding.relPath.localeCompare(b.finding.relPath),
  );
  return rows.map((row) => row.finding);
}

/**
 * Why one loop was flagged, plus the context a single loop cannot carry: how
 * tangled the group around it is, and how many other loops were found there.
 * Without that, a reader fixing one row has no way to tell whether it is the
 * whole problem or one of twenty.
 */
function loopReason(
  loopSize: number,
  groupSize: number,
  loopsFound: number,
  loopsShown: number,
  maxCycleLength: number,
): string {
  const head = `These ${loopSize} files import each other in a loop.`;
  if (groupSize === loopSize && loopsFound === 1) return head;

  const group =
    groupSize > loopSize
      ? ` It sits inside a group of ${groupSize} files that all reach each other.`
      : "";
  const others =
    loopsFound > 1
      ? ` ${loopsFound} loops of ${maxCycleLength} files or fewer were found there${
          loopsShown < loopsFound ? `; the ${loopsShown} shortest are listed` : ""
        }.`
      : "";
  return `${head}${group}${others}`;
}
