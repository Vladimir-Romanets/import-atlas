import { describe, expect, it } from 'vitest';
import { buildIndex, countDescendants, createCollapsedState } from '../render/client/tree';
import { buildLayout } from '../render/client/layout';
import type { RenderNode } from '../render/client/types';

function node(renderId: string, fileId: string, extra: Partial<RenderNode> = {}): RenderNode {
  return {
    renderId,
    fileId,
    label: fileId,
    relPath: fileId,
    layer: 'app',
    note: '',
    warn: '',
    hint: '',
    ref: null,
    importedAs: '*',
    isDeferred: false,
    fanIn: 1,
    children: [],
    depth: 0,
    x: 0,
    y: 0,
    _count: 0,
    ...extra,
  };
}

/** A linear chain of `n` nodes, root first — built with a loop, not recursion. */
function chain(n: number): RenderNode {
  let tail = node(`r${n - 1}`, `f${n - 1}`);
  for (let i = n - 2; i >= 0; i--) {
    tail = node(`r${i}`, `f${i}`, { children: [tail] });
  }
  return tail;
}

describe('buildIndex / countDescendants / createCollapsedState — deep chains (stack-depth regression)', () => {
  it('indexes and counts a 20,000-link chain without overflowing the call stack', () => {
    const N = 20000;
    const root = chain(N);

    let byId: Record<string, RenderNode> = {};
    let parentOf: Record<string, string> = {};
    expect(() => {
      ({ byId, parentOf } = buildIndex([root]));
    }).not.toThrow();

    expect(Object.keys(byId)).toHaveLength(N);
    expect(parentOf[`r${N - 1}`]).toBe(`r${N - 2}`);
    expect(parentOf.r0).toBeUndefined();

    expect(() => countDescendants([root], byId)).not.toThrow();
    // Every node has exactly the rest of the chain below it.
    expect(root._count).toBe(N - 1);
    expect(byId[`r${N - 2}`]._count).toBe(1);
    expect(byId[`r${N - 1}`]._count).toBe(0);
  });

  it('collapses every node past the root on a 20,000-link chain without overflowing the call stack', () => {
    const N = 20000;
    const root = chain(N);

    let collapsed: Set<string> = new Set();
    expect(() => {
      ({ collapsed } = createCollapsedState([root]));
    }).not.toThrow();

    expect(collapsed.has('r0')).toBe(false); // depth 0 is never auto-collapsed
    expect(collapsed.has('r1')).toBe(true);
    expect(collapsed.has(`r${N - 1}`)).toBe(false); // a leaf has nothing to collapse
  });

  it('gives a reference its target\'s count without walking into it', () => {
    const leaf = node('r2', 'shared', { _count: 0 });
    const canonical = node('r1', 'canonical', { children: [leaf], _count: 1 });
    const reference = node('r9', 'canonical', { ref: 'r1' });
    const root = node('r0', 'entry', { children: [canonical, reference] });
    const { byId } = buildIndex([root]);

    countDescendants([root], byId);

    expect(canonical._count).toBe(1);
    expect(reference._count).toBe(1);
  });
});

describe('buildLayout — deep chains (stack-depth regression)', () => {
  it('lays out a 20,000-link fully-expanded chain without overflowing the call stack', () => {
    const N = 20000;
    const root = chain(N);
    const nodes: RenderNode[] = [];
    const edges: [RenderNode, RenderNode][] = [];

    expect(() => buildLayout(root, 0, nodes, edges, new Set())).not.toThrow();

    expect(nodes).toHaveLength(N);
    expect(edges).toHaveLength(N - 1);
    // Every node in a fully-expanded linear chain sits one column deeper
    // than its parent, in the same order the recursive walk pushed them.
    for (let i = 0; i < N; i++) expect(nodes[i].depth).toBe(i);
    // A chain has no siblings to spread a parent between, so every node
    // shares the one row the leaf claims.
    expect(root.y).toBe(nodes[N - 1].y);
  });

  it('centres a parent between its first and last child, as the recursive version did', () => {
    const c1 = node('c1', 'a');
    const c2 = node('c2', 'b');
    const c3 = node('c3', 'c');
    const root = node('r0', 'root', { children: [c1, c2, c3] });
    const nodes: RenderNode[] = [];
    const edges: [RenderNode, RenderNode][] = [];

    buildLayout(root, 0, nodes, edges, new Set());

    expect(root.y).toBe((c1.y + c3.y) / 2);
  });

  it('does not descend into a collapsed node', () => {
    const child = node('c1', 'a');
    const root = node('r0', 'root', { children: [child] });
    const nodes: RenderNode[] = [];
    const edges: [RenderNode, RenderNode][] = [];

    buildLayout(root, 0, nodes, edges, new Set(['r0']));

    expect(nodes).toEqual([root]);
    expect(edges).toEqual([]);
  });
});
