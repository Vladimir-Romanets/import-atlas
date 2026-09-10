import { describe, expect, it } from 'vitest';
import { materializeChildren } from '../render/client/expand';
import type { RenderNode } from '../render/client/types';

function node(renderId: string, fileId: string, extra: Partial<RenderNode> = {}): RenderNode {
  return {
    renderId,
    fileId,
    label: fileId.split('/').pop()!.replace(/\.ts$/, ''),
    relPath: fileId,
    layer: fileId.split('/')[0],
    note: '',
    warn: '',
    hint: '',
    ref: null,
    importedAs: '*',
    fanIn: 1,
    children: [],
    depth: 0,
    x: 0,
    y: 0,
    _count: 0,
    ...extra,
  };
}

/** Indexes a forest the way the viewer does, so the helper sees what it would at runtime. */
function index(roots: RenderNode[]): {
  byId: Record<string, RenderNode>;
  parentOf: Record<string, string>;
} {
  const byId: Record<string, RenderNode> = {};
  const parentOf: Record<string, string> = {};
  const walk = (n: RenderNode, parent: RenderNode | null) => {
    byId[n.renderId] = n;
    if (parent) parentOf[n.renderId] = parent.renderId;
    n.children.forEach((c) => { walk(c, n); });
  };
  roots.forEach((r) => { walk(r, null); });
  return { byId, parentOf };
}

/**
 * The shape the payload actually produces: one full expansion of a file,
 * plus a reference to it from somewhere else.
 *   canonical ui/index.ts -> [ui/Button.ts, ui/Icon.ts]
 *   reference to it, with no children of its own
 */
function forestWithReference() {
  const button = node('r2', 'ui/Button.ts', { _count: 0 });
  const icon = node('r3', 'ui/Icon.ts', { _count: 0 });
  const canonical = node('r1', 'ui/index.ts', { _count: 2, children: [button, icon] });
  const reference = node('r9', 'ui/index.ts', { ref: 'r1', _count: 2 });
  const root = node('r0', 'app/entry.ts', { children: [canonical, reference] });
  return { root, canonical, reference, button, icon };
}

describe('materializeChildren', () => {
  it('copies one level of the referenced occurrence\'s children', () => {
    const { root, reference } = forestWithReference();
    const { byId, parentOf } = index([root]);

    expect(materializeChildren(reference, byId, parentOf)).toBe(true);
    expect(reference.children.map((c) => c.fileId)).toEqual(['ui/Button.ts', 'ui/Icon.ts']);
  });

  it('gives every copy an id of its own, since the viewer looks nodes up by it', () => {
    const { root, reference } = forestWithReference();
    const { byId, parentOf } = index([root]);
    const before = new Set(Object.keys(byId));

    materializeChildren(reference, byId, parentOf);

    for (const child of reference.children) {
      expect(before.has(child.renderId)).toBe(false);
      expect(byId[child.renderId]).toBe(child);
      expect(parentOf[child.renderId]).toBe(reference.renderId);
    }
  });

  it('makes each copy a reference in turn, so the next level can be opened too', () => {
    const { root, reference, button, icon } = forestWithReference();
    const { byId, parentOf } = index([root]);

    materializeChildren(reference, byId, parentOf);

    expect(reference.children.map((c) => c.ref)).toEqual([button.renderId, icon.renderId]);
    expect(reference.children.every((c) => c.children.length === 0)).toBe(true);
  });

  it('points a copy of a reference onward to the real occurrence, not at another reference', () => {
    // canonical shared.ts, referenced from inside the subtree being copied.
    const shared = node('r5', 'app/shared.ts', { _count: 0 });
    const innerRef = node('r6', 'app/shared.ts', { ref: 'r5' });
    const canonical = node('r1', 'ui/index.ts', { _count: 1, children: [innerRef] });
    const reference = node('r9', 'ui/index.ts', { ref: 'r1', _count: 1 });
    const root = node('r0', 'app/entry.ts', { children: [shared, canonical, reference] });
    const { byId, parentOf } = index([root]);

    materializeChildren(reference, byId, parentOf);

    expect(reference.children[0].ref).toBe('r5');
  });

  it('carries the descendant count of whatever the copy stands for', () => {
    const grandchild = node('r4', 'ui/Base.ts');
    const button = node('r2', 'ui/Button.ts', { _count: 1, children: [grandchild] });
    const canonical = node('r1', 'ui/index.ts', { _count: 2, children: [button] });
    const reference = node('r9', 'ui/index.ts', { ref: 'r1', _count: 2 });
    const root = node('r0', 'app/entry.ts', { children: [canonical, reference] });
    const { byId, parentOf } = index([root]);

    materializeChildren(reference, byId, parentOf);

    // The copy of Button promises Button's own subtree, so it still offers
    // a chevron rather than reading as a leaf.
    expect(reference.children[0]._count).toBe(1);
  });

  it('keeps the labelling of the occurrence it copies', () => {
    const { root, reference } = forestWithReference();
    const { byId, parentOf } = index([root]);

    materializeChildren(reference, byId, parentOf);
    const copy = reference.children[0];

    expect(copy.fileId).toBe('ui/Button.ts');
    expect(copy.label).toBe('Button');
    expect(copy.relPath).toBe('ui/Button.ts');
  });

  it('does nothing the second time, so re-opening a node cannot duplicate its children', () => {
    const { root, reference } = forestWithReference();
    const { byId, parentOf } = index([root]);

    materializeChildren(reference, byId, parentOf);
    const ids = reference.children.map((c) => c.renderId);

    expect(materializeChildren(reference, byId, parentOf)).toBe(false);
    expect(reference.children.map((c) => c.renderId)).toEqual(ids);
  });

  it('does nothing for a node that is a full expansion already', () => {
    const { root, canonical } = forestWithReference();
    const { byId, parentOf } = index([root]);

    expect(materializeChildren(canonical, byId, parentOf)).toBe(false);
    expect(canonical.children).toHaveLength(2);
  });

  it('does nothing when the referenced occurrence is a leaf', () => {
    const canonical = node('r1', 'app/leaf.ts');
    const reference = node('r9', 'app/leaf.ts', { ref: 'r1' });
    const root = node('r0', 'app/entry.ts', { children: [canonical, reference] });
    const { byId, parentOf } = index([root]);

    expect(materializeChildren(reference, byId, parentOf)).toBe(false);
    expect(reference.children).toEqual([]);
  });

  it('does nothing when the reference points at an id that is not there', () => {
    const reference = node('r9', 'app/gone.ts', { ref: 'missing' });
    const root = node('r0', 'app/entry.ts', { children: [reference] });
    const { byId, parentOf } = index([root]);

    expect(materializeChildren(reference, byId, parentOf)).toBe(false);
  });

  it('opens level by level, each copy fetching only its own children', () => {
    const grandchild = node('r4', 'ui/Base.ts', { _count: 0 });
    const button = node('r2', 'ui/Button.ts', { _count: 1, children: [grandchild] });
    const canonical = node('r1', 'ui/index.ts', { _count: 2, children: [button] });
    const reference = node('r9', 'ui/index.ts', { ref: 'r1', _count: 2 });
    const root = node('r0', 'app/entry.ts', { children: [canonical, reference] });
    const { byId, parentOf } = index([root]);

    materializeChildren(reference, byId, parentOf);
    const buttonCopy = reference.children[0];
    expect(buttonCopy.children).toEqual([]);

    materializeChildren(buttonCopy, byId, parentOf);
    expect(buttonCopy.children.map((c) => c.fileId)).toEqual(['ui/Base.ts']);
  });
});
