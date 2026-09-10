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

export function countDescendants(forest: RenderNode[]): void {
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
}

export function createCollapsedState(forest: RenderNode[]): { collapsed: Set<string>; defaultCollapse: () => void } {
  const collapsed = new Set<string>();
  const defaultCollapse = () => {
    collapsed.clear();
    const walk = (node: RenderNode, depth: number) => {
      if (node.ref) return;
      if (depth >= 1 && node.children.length) collapsed.add(node.renderId);
      node.children.forEach((c) => { walk(c, depth+1); });
    };
    forest.forEach((root) => { walk(root, 0); });
  };
  defaultCollapse();
  return { collapsed, defaultCollapse };
}
