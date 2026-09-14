import type { GraphData, GraphEdge, GraphNode } from '../../../types';
import type { GraphIndex } from './types';

export interface VisibleSet {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/**
 * How many importers of a file the canvas isn't showing — what the fan-in
 * badge has left to offer, and what it says on hover.
 *
 * A file reached from above always has the importer that opened it on
 * screen, so a badge there counts only what the reader has just done — and
 * since most files are reached that way, the count used to sit beside
 * nearly every box saying "1". The same is true of a barrel whose twelve
 * importers are all drawn: the twelve lines arriving at it say who they are
 * better than a number does.
 *
 * A file importing itself is nobody else's importer, and is excluded here
 * the same way `GraphNode.fanIn` excludes it.
 */
export function hiddenImporterCount(
  id: string,
  index: GraphIndex,
  isVisible: (id: string) => boolean,
): number {
  let count = 0;
  for (const edge of index.inEdges[id] ?? []) {
    if (edge.from !== id && !isVisible(edge.from)) count += 1;
  }
  return count;
}

/**
 * The same count in the other direction: how many of a file's imports the
 * canvas isn't showing, and so whether opening it would draw anything.
 *
 * Asking the graph "does this file import anything" is not the same
 * question, and answering that one instead is how a click comes to spend a
 * whole relayout marking a node open without a single box appearing — the
 * files it imports were already on screen, reached from somewhere else.
 *
 * A file importing itself imports nothing new by definition, and is
 * excluded here the same way `GraphNode.fanOut` excludes it — which is what
 * keeps this in step with the chevron, drawn from that same count.
 */
export function hiddenImportCount(
  id: string,
  index: GraphIndex,
  isVisible: (id: string) => boolean,
): number {
  let count = 0;
  for (const edge of index.outEdges[id] ?? []) {
    if (edge.to !== id && !isVisible(edge.to)) count += 1;
  }
  return count;
}

export interface Visibility {
  /** Nodes whose imports are shown — what the chevron on a node's right toggles. */
  expanded: Set<string>;
  /** Nodes whose importers are shown — what the fan-in badge on a node's left toggles. */
  importersShown: Set<string>;
  toggle: (id: string) => void;
  toggleImporters: (id: string) => void;
  /** Draws a node's importers, whether or not they are drawn already — what a search landing on a file does. */
  showImporters: (id: string) => void;
  expandAll: () => void;
  collapseAll: () => void;
  /** Opens whatever it takes for `id` to be on screen. Returns false if nothing leads to it. */
  reveal: (id: string) => boolean;
  compute: () => VisibleSet;
  isFullyExpanded: () => boolean;
}

/**
 * What the canvas shows, out of a graph far too large to draw at once.
 *
 * The rule is deliberately asymmetric, and it is what makes the merged view
 * readable: a node becomes visible by being *opened into* from something
 * already visible, but an edge is drawn as soon as BOTH its ends are on
 * screen — whether or not the reader is the one who opened them.
 *
 * That second half is the whole point of this viewer. Open two sibling
 * features that both use one barrel and the barrel appears once, with both
 * edges drawn, including the one from the feature you didn't expand
 * through. The shared dependency is the picture, rather than something to
 * be reconstructed from two identical boxes in different branches.
 */
export function createVisibility(
  graph: GraphData,
  index: GraphIndex,
): Visibility {
  const expanded = new Set<string>(graph.entries);
  const importersShown = new Set<string>();

  const expandableIds = (): string[] =>
    graph.nodes.filter((node) => node.fanOut > 0).map((node) => node.id);

  const toggle = (id: string): void => {
    if (expanded.has(id)) expanded.delete(id);
    else expanded.add(id);
  };

  const toggleImporters = (id: string): void => {
    if (importersShown.has(id)) importersShown.delete(id);
    else importersShown.add(id);
  };

  const showImporters = (id: string): void => {
    importersShown.add(id);
  };

  const expandAll = (): void => {
    for (const id of expandableIds()) expanded.add(id);
  };

  const collapseAll = (): void => {
    expanded.clear();
    importersShown.clear();
    // Entry points are the one thing that is never closed: with them shut
    // the canvas would be empty, with no way back in.
    for (const id of graph.entries) expanded.add(id);
  };

  const isFullyExpanded = (): boolean =>
    expandableIds().every((id) => expanded.has(id));

  const compute = (): VisibleSet => {
    const visible = new Set<string>();
    const queue: string[] = [];
    for (const id of graph.entries) {
      if (index.nodeById[id] === undefined || visible.has(id)) continue;
      visible.add(id);
      queue.push(id);
    }

    // One queue for both directions: a node pulled in as an importer can
    // itself be one whose imports or importers are open, so this has to
    // run to a fixpoint rather than in two passes.
    for (let i = 0; i < queue.length; i++) {
      const id = queue[i];
      if (expanded.has(id)) {
        for (const edge of index.outEdges[id] ?? []) {
          if (visible.has(edge.to)) continue;
          visible.add(edge.to);
          queue.push(edge.to);
        }
      }
      if (importersShown.has(id)) {
        for (const edge of index.inEdges[id] ?? []) {
          if (visible.has(edge.from)) continue;
          visible.add(edge.from);
          queue.push(edge.from);
        }
      }
    }

    const nodes = graph.nodes.filter((node) => visible.has(node.id));
    const edges = graph.edges.filter(
      (edge) => visible.has(edge.from) && visible.has(edge.to),
    );
    return { nodes, edges };
  };

  const reveal = (id: string): boolean => {
    if (index.nodeById[id] === undefined) return false;
    if (graph.entries.indexOf(id) !== -1) return true;

    // Shortest way in, walked backwards over the importers: with several
    // routes to the same file, the fewest nodes opened is the least the
    // reader has to take in to see why it is on screen.
    const cameFrom = new Map<string, string>();
    const seen = new Set<string>([id]);
    const queue = [id];
    let landed: string | null = null;

    for (let i = 0; i < queue.length && landed === null; i++) {
      const current = queue[i];
      for (const edge of index.inEdges[current] ?? []) {
        if (seen.has(edge.from)) continue;
        seen.add(edge.from);
        cameFrom.set(edge.from, current);
        if (graph.entries.indexOf(edge.from) !== -1) {
          landed = edge.from;
          break;
        }
        queue.push(edge.from);
      }
    }

    if (landed === null) return false;
    // Everything from the entry down to `id`'s importer has to be open for
    // `id` itself to be reached; `id` is left as the reader finds it.
    for (let step: string | undefined = landed; step !== undefined && step !== id; step = cameFrom.get(step)) {
      expanded.add(step);
    }
    return true;
  };

  return {
    expanded,
    importersShown,
    toggle,
    toggleImporters,
    showImporters,
    expandAll,
    collapseAll,
    reveal,
    compute,
    isFullyExpanded,
  };
}
