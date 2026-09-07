import { ROW_H, COL_W } from './constants';
import type { RenderNode } from './types';

export function shortLabel(s: string): string {
  return s.length > 28 ? s.slice(0,27) + '…' : s;
}

export function buildLayout(
  root: RenderNode,
  startY: number,
  nodes: RenderNode[],
  edges: [RenderNode, RenderNode][],
  collapsed: Set<string>
): number {
  let cursor = startY;
  const visit = (node: RenderNode, depth: number, parent: RenderNode | null): number => {
    node.depth = depth;
    node.x = depth * COL_W;
    nodes.push(node);
    if (parent) edges.push([parent, node]);
    const expanded = !node.ref && node.children.length > 0 && !collapsed.has(node.renderId);
    if (expanded){
      const ys = node.children.map((c) => visit(c, depth+1, node));
      node.y = (ys[0] + ys[ys.length-1]) / 2;
    } else {
      node.y = cursor;
      cursor += ROW_H;
    }
    return node.y;
  };
  visit(root, 0, null);
  return cursor;
}
