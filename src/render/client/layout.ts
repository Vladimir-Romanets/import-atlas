import { ROW_H, COL_W } from './constants';
import type { RenderNode } from './types';

export function shortLabel(s: string): string {
  return s.length > 28 ? s.slice(0,27) + '…' : s;
}

/** For an "index" node, the name of the folder it lives in (e.g. "utils" for "src/utils/index.ts"). */
export function folderOf(relPath: string): string {
  const parts = relPath.split('/');
  return parts.length > 1 ? parts[parts.length - 2] : '';
}

/** The file's own basename WITH extension (e.g. "Button.tsx" for "src/components/Button.tsx") — unlike `label`, which has the extension stripped. */
export function fileNameOf(relPath: string): string {
  const parts = relPath.split('/');
  return parts[parts.length - 1];
}

export function buildLayout(
  root: RenderNode,
  startY: number,
  nodes: RenderNode[],
  edges: [RenderNode, RenderNode][],
  collapsed: Set<string>,
  hideUnused: boolean = false
): number {
  let cursor = startY;
  const visit = (node: RenderNode, depth: number, parent: RenderNode | null): number | null => {
    if (hideUnused && node.unused) return null;
    node.depth = depth;
    node.x = depth * COL_W;
    nodes.push(node);
    if (parent) edges.push([parent, node]);
    const expanded = !node.ref && node.children.length > 0 && !collapsed.has(node.renderId);
    if (expanded){
      const ys = node.children
        .map((c) => visit(c, depth+1, node))
        .filter((y): y is number => y !== null);
      node.y = ys.length ? (ys[0] + ys[ys.length-1]) / 2 : cursor;
      if (!ys.length){
        cursor += ROW_H;
      }
    } else {
      node.y = cursor;
      cursor += ROW_H;
    }
    return node.y;
  };
  const y = visit(root, 0, null);
  if (y === null) return startY;
  return cursor;
}
