import type { RenderNode } from './types';

/**
 * A node can be `unused: false` itself while still being invisible, because
 * `buildLayout` prunes an unused node's *entire* subtree without descending
 * into it — so any ancestor being unused (while "hide unused" is on) hides
 * this node too, regardless of its own flag.
 */
export function isVisible(
  node: RenderNode,
  byId: Record<string, RenderNode>,
  parentOf: Record<string, string>,
  hideUnused: boolean,
): boolean {
  if (!hideUnused) return true;
  let current: RenderNode | undefined = node;
  while (current) {
    if (current.unused) return false;
    const parentId: string | undefined = parentOf[current.renderId];
    current = parentId ? byId[parentId] : undefined;
  }
  return true;
}
