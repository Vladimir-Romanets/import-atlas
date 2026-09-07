import type { TreeNode } from '../../types';

/**
 * A tree node once the client has laid it out: same shape as the JSON payload's
 * TreeNode, plus scratch fields the layout/render pipeline fills in before anything
 * reads them (countDescendants sets `_count`; buildLayout sets `depth`/`x`/`y`).
 */
export interface RenderNode extends TreeNode {
  children: RenderNode[];
  depth: number;
  x: number;
  y: number;
  _count: number;
}

export type ColorPair = readonly [string, string];
