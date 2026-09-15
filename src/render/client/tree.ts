import type { RenderNode } from './types';

// Every walk below uses an explicit stack rather than recursion: the tree
// nests one level per import-chain link, and all three functions run over
// the whole forest at page load, before collapsing can make it shallower.

export function buildIndex(forest: RenderNode[]): { byId: Record<string, RenderNode>; parentOf: Record<string, string> } {
  const byId: Record<string, RenderNode> = {};
  const parentOf: Record<string, string> = {};
  // Each node's entries are independent of its neighbours', so a plain
  // stack of pending nodes is enough — nothing needs revisiting once its
  // children are queued, unlike countDescendants below.
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
 * Fills in `_count`, the descendants a node stands for — what goes in its
 * collapsed badge, and whether it gets a chevron at all.
 *
 * A reference carries the count of the occurrence it points at, not zero:
 * it holds no children until expanded, but the subtree it promises is the
 * one already counted over there.
 */
export function countDescendants(forest: RenderNode[], byId: Record<string, RenderNode>): void {
  // Post-order: a node's `_count` is filled in once every child has
  // reported theirs. `descend` returns a child's count directly when
  // nothing needs walking (a leaf, or a ref); otherwise it pushes a frame
  // and the count arrives when that frame is popped — where a recursive
  // call would have returned it.
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

  // Second pass: a reference can point at an occurrence that hadn't been
  // counted yet when the walk went past it.
  Object.keys(byId).forEach((renderId) => {
    const node = byId[renderId];
    if (node.ref) node._count = byId[node.ref]?._count ?? 0;
  });
}

export function createCollapsedState(forest: RenderNode[]): { collapsed: Set<string>; defaultCollapse: () => void } {
  const collapsed = new Set<string>();
  const defaultCollapse = () => {
    collapsed.clear();
    // References are walked into too: once opened, one holds real children
    // that "Collapse" has to reach. Every node's outcome depends only on
    // its own depth, so — like buildIndex — a plain stack is enough.
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
