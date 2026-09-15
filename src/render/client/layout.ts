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

  // Written with an explicit stack rather than recursion: the tree can
  // nest one level per import-chain link, and this
  // runs on every render, not just once at load. A node is pushed to
  // `nodes` (and its edge from its parent recorded) the moment the walk
  // reaches it — the same order the recursive version pushed in — but its
  // own `y` is only known once its children have theirs. `enter` returns
  // that `y` directly when there is nothing to expand (a leaf, or
  // collapsed); otherwise it pushes a frame and returns nothing, and the
  // `y` is filled in — centred between the first and last child's, exactly
  // what the original read out of `ys[0]`/`ys[ys.length-1]` — once that
  // frame is popped, which is also when the parent frame's own first/last
  // is updated.
  interface Frame {
    node: RenderNode;
    index: number;
    sawFirst: boolean;
    firstY: number;
    lastY: number;
  }
  const stack: Frame[] = [];

  const record = (frame: Frame | undefined, y: number): void => {
    if (!frame) return;
    if (!frame.sawFirst) {
      frame.firstY = y;
      frame.sawFirst = true;
    }
    frame.lastY = y;
  };

  const enter = (node: RenderNode, depth: number, parent: RenderNode | null): number | undefined => {
    node.depth = depth;
    node.x = depth * COL_W;
    nodes.push(node);
    if (parent) edges.push([parent, node]);
    // A reference counts as expandable too, once its children have been
    // copied in — it is only a leaf while nobody has opened it.
    const expanded = node.children.length > 0 && !collapsed.has(node.renderId);
    if (!expanded) {
      node.y = cursor;
      cursor += ROW_H;
      return node.y;
    }
    stack.push({ node, index: 0, sawFirst: false, firstY: 0, lastY: 0 });
    return undefined;
  };

  if (enter(root, 0, null) === undefined) {
    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      if (frame.index < frame.node.children.length) {
        const child = frame.node.children[frame.index++];
        const y = enter(child, frame.node.depth + 1, frame.node);
        if (y !== undefined) record(frame, y);
        continue;
      }
      // Centred on its children: the midpoint between the first one's row
      // and the last one's.
      frame.node.y = (frame.firstY + frame.lastY) / 2;
      const finishedY = frame.node.y;
      stack.pop();
      record(stack[stack.length - 1], finishedY);
    }
  }
  return cursor;
}
