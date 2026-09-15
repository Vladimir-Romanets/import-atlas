import type { TreeNode } from '../../types';

/**
 * A laid-out tree node: the payload's TreeNode plus the scratch fields the
 * pipeline fills in before anything reads them — `_count` from
 * countDescendants, `depth`/`x`/`y` from buildLayout.
 */
export interface RenderNode extends TreeNode {
  children: RenderNode[];
  depth: number;
  x: number;
  y: number;
  _count: number;
}

export type ColorPair = readonly [string, string];
