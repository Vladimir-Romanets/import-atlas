import { edgeKey } from '../../../utils/edgeKey';
import type { GraphEdge } from '../../../types';
import type { GraphIndex } from './types';

export interface Highlight {
  selectedId: string | null;
  /** Nodes that stay at full strength; everything else is dimmed. */
  nodes: Set<string>;
  /** Edges that stay at full strength, keyed by `edgeKey(from, to)`. */
  edges: Set<string>;
  /**
   * Edges out of a barrel that the selection actually reaches through it,
   * keyed the same way — drawn emphatically rather than merely undimmed.
   */
  reached: Set<string>;
}

const EMPTY: Highlight = {
  selectedId: null,
  nodes: new Set(),
  edges: new Set(),
  reached: new Set(),
};

/** Whether an edge asking for `request` gets to what `exposed` forwards. */
function reaches(request: string[] | '*', exposed: string[] | '*'): boolean {
  // Same "fail open" rule the tree uses: where the graph can't say which
  // names a reach touches, it may touch any of them.
  if (request === '*' || exposed === '*') return true;
  return exposed.some((name) => request.indexOf(name) !== -1);
}

/**
 * What to keep lit when a node is selected: the node, everything directly
 * importing it, everything it directly imports — and, one hop further,
 * whatever the selection reaches *through* a barrel.
 *
 * That last part is this view's answer to a question the tree solves
 * structurally. The tree can afford to give a barrel a separate expansion
 * per set of names asked of it, showing each importer only its own share.
 * A merged graph draws the barrel once for everyone, so the same
 * information has to be carried by emphasis instead: select the importer
 * and the two re-exports it actually uses light up among the barrel's
 * twenty, while the barrel keeps its full shape on screen.
 */
export function computeHighlight(
  selectedId: string | null,
  index: GraphIndex,
): Highlight {
  if (selectedId === null || index.nodeById[selectedId] === undefined) {
    return EMPTY;
  }

  const nodes = new Set<string>([selectedId]);
  const edges = new Set<string>();
  const reached = new Set<string>();

  const inEdges: GraphEdge[] = index.inEdges[selectedId] ?? [];
  for (const edge of inEdges) {
    nodes.add(edge.from);
    edges.add(edgeKey(edge.from, edge.to));
  }

  const outEdges: GraphEdge[] = index.outEdges[selectedId] ?? [];
  for (const edge of outEdges) {
    nodes.add(edge.to);
    edges.add(edgeKey(edge.from, edge.to));

    for (const onward of index.outEdges[edge.to] ?? []) {
      // Only re-exports forward a name onward; a barrel's own plain
      // imports are its business, not its consumers'.
      if (!onward.isReexport) continue;
      if (!reaches(edge.names, onward.exposedNames)) continue;
      nodes.add(onward.to);
      reached.add(edgeKey(onward.from, onward.to));
    }
  }

  return { selectedId, nodes, edges, reached };
}
