import type { RenderNode } from './types';

// Every walk below is written with an explicit stack rather than
// recursion. The tree can nest one level per import-chain link, and these
// three functions all run once per page load
// over the whole forest, well before any collapsing has a chance to make
// the visible tree shallower.

export function buildIndex(forest: RenderNode[]): { byId: Record<string, RenderNode>; parentOf: Record<string, string> } {
  const byId: Record<string, RenderNode> = {};
  const parentOf: Record<string, string> = {};
  // Every node's own entries are independent of its neighbours', so a
  // plain stack of pending nodes is enough — nothing needs revisiting once
  // its children are queued, unlike countDescendants below.
  const stack: { node: RenderNode; parent: RenderNode | null }[] = [];
  forest.forEach((root) => { stack.push({ node: root, parent: null }); });
  while (stack.length > 0) {
    const { node, parent } = stack.pop()!;
    byId[node.renderId] = node;
    if (parent) parentOf[node.renderId] = parent.renderId;
    node.children.forEach((c) => { stack.push({ node: c, parent: node }); });
  }
  return { byId, parentOf };
}

/**
 * Fills in `_count`, the number of descendants a node stands for — what the
 * viewer puts in its collapsed badge, and how it decides whether to draw a
 * chevron at all.
 *
 * A reference carries the count of the occurrence it points at rather than
 * zero: it holds no children of its own until someone expands it, but the
 * subtree it promises is exactly the one already counted over there.
 */
export function countDescendants(forest: RenderNode[], byId: Record<string, RenderNode>): void {
  // Post-order, so a node's own `_count` is only filled in once every
  // child has reported theirs. `descend` returns a child's count directly
  // when nothing more needs walking (a leaf, or a ref); otherwise it
  // pushes a frame and returns nothing, and the count comes later, when
  // that frame is popped — the same information a recursive call would
  // have handed back on return.
  interface Frame { node: RenderNode; index: number; sum: number }
  const stack: Frame[] = [];

  const descend = (node: RenderNode): number | undefined => {
    if (node.ref || node.children.length === 0) {
      node._count = 0;
      return 0;
    }
    stack.push({ node, index: 0, sum: 0 });
    return undefined;
  };

  forest.forEach((root) => {
    if (descend(root) !== undefined) return;
    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      if (frame.index < frame.node.children.length) {
        const childCount = descend(frame.node.children[frame.index++]);
        if (childCount !== undefined) frame.sum += 1 + childCount;
        continue;
      }
      frame.node._count = frame.sum;
      stack.pop();
      const parent = stack[stack.length - 1];
      if (parent) parent.sum += 1 + frame.node._count;
    }
  });

  // Second pass, because a reference can point at an occurrence that hadn't
  // been counted yet when the walk went past it.
  Object.keys(byId).forEach((renderId) => {
    const node = byId[renderId];
    if (node.ref) node._count = byId[node.ref]?._count ?? 0;
  });
}

export function createCollapsedState(forest: RenderNode[]): { collapsed: Set<string>; defaultCollapse: () => void } {
  const collapsed = new Set<string>();
  const defaultCollapse = () => {
    collapsed.clear();
    // References are walked into as well: once one has been opened it holds
    // real children, and "Collapse" has to reach them like any others.
    // Every node's outcome depends only on its own depth, so — like
    // buildIndex — a plain stack of pending nodes is enough.
    const stack: { node: RenderNode; depth: number }[] = [];
    forest.forEach((root) => { stack.push({ node: root, depth: 0 }); });
    while (stack.length > 0) {
      const { node, depth } = stack.pop()!;
      if (depth >= 1 && node.children.length) collapsed.add(node.renderId);
      node.children.forEach((c) => { stack.push({ node: c, depth: depth + 1 }); });
    }
  };
  defaultCollapse();
  return { collapsed, defaultCollapse };
}
