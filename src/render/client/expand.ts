import type { RenderNode } from './types';

let cloneCount = 0;

/**
 * Gives a reference node the children of the occurrence it points at, one
 * level deep, so it can be opened where it stands instead of only jumping
 * away to the full expansion.
 *
 * Only one level is copied, and every copied child becomes a reference in
 * turn — to the occurrence it was copied from, or onward to whatever that
 * one already pointed at. So expanding never costs more than the width of
 * a single node's imports, and the same call handles the next level down
 * when the reader asks for it. That matters: the payload holds one
 * expansion per file precisely because expanding every occurrence up front
 * would multiply out to millions of nodes on a real project.
 *
 * Returns whether anything was added, so the caller can skip a re-render
 * it doesn't need.
 */
export function materializeChildren(
  node: RenderNode,
  byId: Record<string, RenderNode>,
  parentOf: Record<string, string>,
): boolean {
  if (!node.ref || node.children.length > 0) return false;

  const target = byId[node.ref];
  if (!target || target.children.length === 0) return false;

  node.children = target.children.map((child) => {
    // A child that is itself a reference points onward to the same place it
    // did, rather than at another reference — one hop, however many copies
    // of a copy the reader opens.
    const ref = child.ref ?? child.renderId;
    const clone: RenderNode = {
      ...child,
      // `c`-prefixed so a copy can never collide with a renderId the scan
      // assigned, whatever order things are opened in.
      renderId: `c${cloneCount++}`,
      ref,
      children: [],
      // It stands for the same subtree its source does, so it makes the
      // same promise in its badge.
      _count: byId[ref]?._count ?? 0,
    };
    byId[clone.renderId] = clone;
    parentOf[clone.renderId] = node.renderId;
    return clone;
  });

  return true;
}
