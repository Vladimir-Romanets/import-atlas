import { ROW_H, COL_W } from './constants';
import type { RenderNode } from './types';

// Truncates by estimated rendered width rather than raw character count.
// Labels are often ALL_CAPS/snake_case identifiers rendered bold — those
// glyphs are noticeably wider than lowercase text, so a flat char-count
// cutoff (e.g. 28) undershoots and lets wide labels overflow the node box.
const WIDE_CHAR = /[A-Z0-9_]/;
const MAX_WIDTH = 28;

export function shortLabel(s: string): string {
  let width = 0;
  for (let i = 0; i < s.length; i++) {
    width += WIDE_CHAR.test(s[i]) ? 1.3 : 1;
    if (width > MAX_WIDTH) return s.slice(0, i) + '…';
  }
  return s;
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
      // Centred on its children: the midpoint between the first one's row
      // and the last one's.
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
