import type { RenderNode } from './types';

export function buildIndex(forest: RenderNode[]): { byId: Record<string, RenderNode>; parentOf: Record<string, string> } {
  const byId: Record<string, RenderNode> = {};
  const parentOf: Record<string, string> = {};
  const index = (node: RenderNode, parent: RenderNode | null) => {
    byId[node.renderId] = node;
    if (parent) parentOf[node.renderId] = parent.renderId;
    node.children.forEach((c) => { index(c, node); });
  };
  forest.forEach((root) => { index(root, null); });
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
  const countDesc = (node: RenderNode): number => {
    if (node.ref || !node.children.length){
      node._count = 0;
      return 0;
    }
    let total = 0;
    node.children.forEach((c) => {
      total += 1 + countDesc(c);
    });
    node._count = total;
    return total;
  };
  forest.forEach(countDesc);

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
    const walk = (node: RenderNode, depth: number) => {
      if (depth >= 1 && node.children.length) collapsed.add(node.renderId);
      node.children.forEach((c) => { walk(c, depth+1); });
    };
    forest.forEach((root) => { walk(root, 0); });
  };
  defaultCollapse();
  return { collapsed, defaultCollapse };
}
