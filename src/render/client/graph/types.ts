import type { GraphEdge, GraphNode } from '../../../types';

/** A graph node once the layout has given it a place on the canvas. */
export interface LayoutNode extends GraphNode {
  x: number;
  y: number;
  /** Position within its own column, after the ordering pass. */
  row: number;
}

/** A drawn edge, resolved to the two laid-out nodes it connects. */
export interface LayoutEdge {
  edge: GraphEdge;
  from: LayoutNode;
  to: LayoutNode;
}

/**
 * The graph payload turned into the lookups everything else needs. Built
 * once at startup: the arrays in the payload are ordered for layout, not
 * for random access, and every interaction below wants both directions of
 * every edge.
 */
export interface GraphIndex {
  nodeById: Record<string, GraphNode>;
  /** Edges leaving a node, in the order its import statements appear. */
  outEdges: Record<string, GraphEdge[]>;
  /** Edges arriving at a node — the half a tree can't show, and the reason this view exists. */
  inEdges: Record<string, GraphEdge[]>;
}

export function buildGraphIndex(
  nodes: GraphNode[],
  edges: GraphEdge[],
): GraphIndex {
  const nodeById: Record<string, GraphNode> = {};
  const outEdges: Record<string, GraphEdge[]> = {};
  const inEdges: Record<string, GraphEdge[]> = {};
  for (const node of nodes) {
    nodeById[node.id] = node;
    outEdges[node.id] = [];
    inEdges[node.id] = [];
  }
  for (const edge of edges) {
    outEdges[edge.from]?.push(edge);
    inEdges[edge.to]?.push(edge);
  }
  return { nodeById, outEdges, inEdges };
}
