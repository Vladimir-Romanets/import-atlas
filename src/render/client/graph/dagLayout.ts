import type { GraphEdge, GraphNode } from '../../../types';
import { COL_W, ROW_H } from '../constants';
import type { LayoutEdge, LayoutNode } from './types';

export interface GraphLayout {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
}

/**
 * How many times rows are re-sorted to untangle edges. Each sweep is one
 * pass over every column; the first two do nearly all the work, and past
 * four the picture stops changing.
 */
const ORDER_SWEEPS = 4;
/** How many times rows are nudged towards their neighbours' height. */
const COORD_PASSES = 3;

const mean = (values: number[]): number => {
  let total = 0;
  for (const v of values) total += v;
  return total / values.length;
};

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
};

/**
 * Columns for what is on screen: the longest path to each node *within the
 * visible set*, so every forward edge still points rightwards and no node
 * sits further right than it has to.
 *
 * Measuring against the visible set rather than the whole project is what
 * keeps the picture compact. `GraphNode.depth` is the same measurement
 * taken over everything, and using it directly puts a widely-shared barrel
 * in the column of its deepest importer anywhere in the codebase — three
 * hundred columns right of the entry point that also imports it directly,
 * with an edge running the whole way back. Nodes do shift sideways as
 * things are opened and closed, but only then, and only because what they
 * sit behind has actually changed.
 */
function assignColumns(
  nodes: LayoutNode[],
  edges: { from: string; to: string; isBackEdge: boolean }[],
): void {
  const column = new Map<string, number>();
  const pendingIn = new Map<string, number>();
  const out = new Map<string, string[]>();
  for (const node of nodes) {
    column.set(node.id, 0);
    pendingIn.set(node.id, 0);
    out.set(node.id, []);
  }
  for (const edge of edges) {
    // A cycle-closing edge is left out here for the same reason it was cut
    // when the graph was built: nothing can be laid out left to right
    // while it is in.
    if (edge.isBackEdge || edge.from === edge.to) continue;
    if (!column.has(edge.from) || !column.has(edge.to)) continue;
    out.get(edge.from)!.push(edge.to);
    pendingIn.set(edge.to, pendingIn.get(edge.to)! + 1);
  }

  const ready = nodes
    .filter((node) => pendingIn.get(node.id) === 0)
    .map((node) => node.id);
  for (let i = 0; i < ready.length; i++) {
    const id = ready[i];
    const next = column.get(id)! + 1;
    for (const to of out.get(id)!) {
      if (column.get(to)! < next) column.set(to, next);
      const left = pendingIn.get(to)! - 1;
      pendingIn.set(to, left);
      if (left === 0) ready.push(to);
    }
  }

  for (const node of nodes) node.x = column.get(node.id)! * COL_W;
}

/**
 * Places the visible part of the merged graph: columns by distance from
 * whatever is furthest upstream of a node, rows chosen to keep edges from
 * crossing more than they must.
 *
 * The vertical axis is where most of the work happens: repeated barycentre
 * sweeps to order rows, then a few passes pulling each node towards the
 * middle of its neighbours without letting a column's rows overlap.
 */
export function layoutGraph(
  nodes: GraphNode[],
  edges: GraphEdge[],
): GraphLayout {
  const layoutNodes: LayoutNode[] = nodes.map((node) => ({
    ...node,
    x: 0,
    y: 0,
    row: 0,
  }));

  if (layoutNodes.length === 0) {
    return { nodes: [], edges: [] };
  }

  const byId: Record<string, LayoutNode> = {};
  for (const node of layoutNodes) byId[node.id] = node;

  // Neighbours among the VISIBLE nodes only — an edge to something the
  // reader hasn't opened has no row to be pulled towards.
  const upstream: Record<string, LayoutNode[]> = {};
  const downstream: Record<string, LayoutNode[]> = {};
  for (const node of layoutNodes) {
    upstream[node.id] = [];
    downstream[node.id] = [];
  }
  const layoutEdges: LayoutEdge[] = [];
  for (const edge of edges) {
    const from = byId[edge.from];
    const to = byId[edge.to];
    if (from === undefined || to === undefined) continue;
    layoutEdges.push({ edge, from, to });
    // A self-import has nothing to pull: it is drawn as a loop on the node.
    if (from === to) continue;
    upstream[edge.to].push(from);
    downstream[edge.from].push(to);
  }

  assignColumns(layoutNodes, edges);

  // ---------------------------------------------------------------------
  // Columns, in discovery order to start with — `nodes` already arrives
  // sorted that way from `buildGraph`.
  // ---------------------------------------------------------------------
  const columnAt = new Map<number, LayoutNode[]>();
  for (const node of layoutNodes) {
    const column = columnAt.get(node.x);
    if (column === undefined) columnAt.set(node.x, [node]);
    else column.push(node);
  }
  const depths = [...columnAt.keys()].sort((a, b) => a - b);
  const columns = depths.map((depth) => columnAt.get(depth)!);

  const applyRows = (column: LayoutNode[]): void => {
    column.forEach((node, i) => {
      node.row = i;
    });
  };
  columns.forEach(applyRows);

  // ---------------------------------------------------------------------
  // Ordering: sort each column by the average row of its neighbours in the
  // direction the sweep came from. A node with no neighbours on that side
  // keeps the row it has, which is what stops untethered nodes drifting.
  // ---------------------------------------------------------------------
  const sweep = (
    ordered: LayoutNode[][],
    neighbours: Record<string, LayoutNode[]>,
  ): void => {
    for (const column of ordered) {
      const barycentre = new Map<string, number>();
      for (const node of column) {
        const rows = neighbours[node.id].map((n) => n.row);
        barycentre.set(node.id, rows.length > 0 ? mean(rows) : node.row);
      }
      column.sort(
        (a, b) => barycentre.get(a.id)! - barycentre.get(b.id)!,
      );
      applyRows(column);
    }
  };

  for (let i = 0; i < ORDER_SWEEPS; i++) {
    if (i % 2 === 0) sweep(columns.slice(1), upstream);
    else sweep(columns.slice(0, -1).reverse(), downstream);
  }

  // ---------------------------------------------------------------------
  // Coordinates: start evenly spaced, then pull each node towards the
  // median of its neighbours — median rather than mean so one far-flung
  // importer can't drag a node away from the cluster it belongs to.
  // ---------------------------------------------------------------------
  for (const column of columns) {
    column.forEach((node, i) => {
      node.y = i * ROW_H;
    });
  }

  const place = (
    ordered: LayoutNode[][],
    neighbours: Record<string, LayoutNode[]>,
  ): void => {
    for (const column of ordered) {
      const desired = column.map((node) => {
        const ys = neighbours[node.id].map((n) => n.y);
        return ys.length > 0 ? median(ys) : node.y;
      });

      let previous = -Infinity;
      column.forEach((node, i) => {
        node.y = Math.max(desired[i], previous + ROW_H);
        previous = node.y;
      });

      // Rows can only ever be pushed DOWN by the separation rule above, so
      // a crowded column drifts a little further from its neighbours on
      // every pass. Shifting the whole column back by its average drift
      // undoes that without disturbing the spacing inside it.
      const drift = mean(column.map((node, i) => node.y - desired[i]));
      if (drift !== 0) for (const node of column) node.y -= drift;
    }
  };

  for (let i = 0; i < COORD_PASSES; i++) {
    place(columns.slice(1), upstream);
    place(columns.slice(0, -1).reverse(), downstream);
  }

  // ---------------------------------------------------------------------
  // Normalise so the picture starts at the origin.
  // ---------------------------------------------------------------------
  let minY = Infinity;
  for (const node of layoutNodes) {
    if (node.y < minY) minY = node.y;
  }
  for (const node of layoutNodes) node.y -= minY;

  return { nodes: layoutNodes, edges: layoutEdges };
}
