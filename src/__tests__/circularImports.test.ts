import { describe, expect, it } from 'vitest';
import { computeCircularImports } from '../circularImports';
import type { Edge, FileNode, ScanResult } from '../types';

function file(id: string): FileNode {
  return {
    id,
    absPath: `/proj/${id}`,
    relPath: id,
    label: id.split('/').pop()!.replace(/\.ts$/, ''),
    layer: id.split('/')[0],
    externalImports: [],
    unresolvedImports: [],
    exports: null,
  };
}

function edge(from: string, to: string, names: string[] | '*'): Edge {
  return { from, to, names, exposedNames: names, isReexport: false, isDeferred: false };
}

/** An import that only runs when a function is called — `lazy(() => import('./x'))`. */
function deferredEdge(from: string, to: string): Edge {
  return { from, to, names: '*', exposedNames: '*', isReexport: false, isDeferred: true };
}

function makeScan(ids: string[], edges: Edge[]): ScanResult {
  const nodes: Record<string, FileNode> = {};
  for (const id of ids) nodes[id] = file(id);
  const fanIn: Record<string, number> = {};
  for (const e of edges) fanIn[e.to] = (fanIn[e.to] || 0) + 1;
  return { root: '/proj', entries: [], nodes, edges, fanIn, warnings: [], coverageGaps: [] };
}

/** Builds the adjacency `computeCircularImports` itself would build, for asserting path validity. */
function adjacencyOf(edges: Edge[]): Record<string, string[]> {
  const adjacency: Record<string, string[]> = {};
  for (const e of edges) (adjacency[e.from] ||= []).push(e.to);
  return adjacency;
}

/** A path is valid when every consecutive pair is a real edge and it closes back on itself. */
function expectValidCycle(relPath: string, edges: Edge[]): void {
  const ids = relPath.split(' → ');
  expect(ids.length).toBeGreaterThanOrEqual(2);
  expect(ids[0]).toBe(ids[ids.length - 1]);
  const adjacency = adjacencyOf(edges);
  for (let i = 0; i < ids.length - 1; i++) {
    expect(adjacency[ids[i]] ?? [], `${ids[i]} → ${ids[i + 1]}`).toContain(ids[i + 1]);
  }
}

describe('computeCircularImports', () => {
  it('finds nothing in an acyclic graph', () => {
    const scan = makeScan(['a.ts', 'b.ts'], [edge('a.ts', 'b.ts', ['b'])]);
    expect(computeCircularImports(scan)).toEqual([]);
  });

  it('does not mistake a diamond (shared dependency) for a cycle', () => {
    const scan = makeScan(
      ['a.ts', 'b.ts', 'c.ts', 'd.ts'],
      [
        edge('a.ts', 'b.ts', ['b']),
        edge('a.ts', 'c.ts', ['c']),
        edge('b.ts', 'd.ts', ['d']),
        edge('c.ts', 'd.ts', ['d']),
      ],
    );
    expect(computeCircularImports(scan)).toEqual([]);
  });

  it('flags a mutual import between two files', () => {
    const scan = makeScan(
      ['app/a.ts', 'app/b.ts'],
      [edge('app/a.ts', 'app/b.ts', ['b']), edge('app/b.ts', 'app/a.ts', ['a'])],
    );
    const findings = computeCircularImports(scan);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      kind: 'circular-import',
      name: '2 files',
      confidence: 'high',
      relPath: 'app/a.ts → app/b.ts → app/a.ts',
    });
  });

  it('flags a cycle that closes back into a barrel, leaving the entry that merely points into it out of the cycle', () => {
    const scan = makeScan(
      ['app/entry.ts', 'ui/index.ts', 'ui/Button.ts'],
      [
        edge('app/entry.ts', 'ui/index.ts', ['Button']),
        edge('ui/index.ts', 'ui/Button.ts', ['Button']),
        edge('ui/Button.ts', 'ui/index.ts', ['Button']),
      ],
    );
    const findings = computeCircularImports(scan);
    expect(findings).toHaveLength(1);
    expect(findings[0].name).toBe('2 files');
    expect(findings[0].relPath).not.toContain('app/entry.ts');
    expectValidCycle(findings[0].relPath, scan.edges);
  });

  it('reports two independent cycles separately, without their membership leaking into each other', () => {
    const scan = makeScan(
      ['g1/a.ts', 'g1/b.ts', 'g2/a.ts', 'g2/b.ts'],
      [
        edge('g1/a.ts', 'g1/b.ts', ['b']),
        edge('g1/b.ts', 'g1/a.ts', ['a']),
        edge('g2/a.ts', 'g2/b.ts', ['b']),
        edge('g2/b.ts', 'g2/a.ts', ['a']),
      ],
    );
    const findings = computeCircularImports(scan);
    expect(findings).toHaveLength(2);
    for (const f of findings) {
      expect(f.relPath).not.toMatch(/g1.*g2|g2.*g1/);
    }
  });

  it('flags a file that imports itself as a self-import, distinct from a multi-file cycle', () => {
    const scan = makeScan(['x.ts'], [edge('x.ts', 'x.ts', ['x'])]);
    const findings = computeCircularImports(scan);
    expect(findings).toEqual([
      expect.objectContaining({ kind: 'circular-import', name: 'self-import', relPath: 'x.ts → x.ts' }),
    ]);
  });

  it('for a strongly-connected group larger than the cycle it closes on first, returns a valid but not necessarily exhaustive path', () => {
    // g/a -> g/b -> g/c -> g/a (a 3-cycle) plus g/b <-> g/d (a 2-cycle sharing
    // g/b) makes {a,b,c,d} one strongly connected component of size 4, but a
    // DFS from `a` closes the loop at `c` before ever reaching `d`.
    const scan = makeScan(
      ['g/a.ts', 'g/b.ts', 'g/c.ts', 'g/d.ts'],
      [
        edge('g/a.ts', 'g/b.ts', ['b']),
        edge('g/b.ts', 'g/c.ts', ['c']),
        edge('g/c.ts', 'g/a.ts', ['a']),
        edge('g/b.ts', 'g/d.ts', ['d']),
        edge('g/d.ts', 'g/b.ts', ['b']),
      ],
    );
    const findings = computeCircularImports(scan);
    expect(findings).toHaveLength(1);
    expect(findings[0].name).toBe('4 files');
    expectValidCycle(findings[0].relPath, scan.edges);
  });

  it('is deterministic across repeated calls on the same scan', () => {
    const scan = makeScan(
      ['g/a.ts', 'g/b.ts', 'g/c.ts', 'g/d.ts'],
      [
        edge('g/a.ts', 'g/b.ts', ['b']),
        edge('g/b.ts', 'g/c.ts', ['c']),
        edge('g/c.ts', 'g/a.ts', ['a']),
        edge('g/b.ts', 'g/d.ts', ['d']),
        edge('g/d.ts', 'g/b.ts', ['b']),
      ],
    );
    expect(computeCircularImports(scan)).toEqual(computeCircularImports(scan));
  });

  it('does not flag a loop that only closes through a deferred import', () => {
    // a imports b at module scope; b reaches a again only via
    // `lazy(() => import('./a'))`. Nothing is half-evaluated at load time,
    // and the recommendation would have advised the fix already applied.
    const scan = makeScan(
      ['a.ts', 'b.ts'],
      [edge('a.ts', 'b.ts', ['b']), deferredEdge('b.ts', 'a.ts')],
    );
    expect(computeCircularImports(scan)).toEqual([]);
  });

  it('still flags a loop whose every edge is eager, alongside deferred edges elsewhere', () => {
    const scan = makeScan(
      ['a.ts', 'b.ts', 'c.ts'],
      [
        edge('a.ts', 'b.ts', ['b']),
        edge('b.ts', 'a.ts', ['a']),
        deferredEdge('a.ts', 'c.ts'),
      ],
    );
    const findings = computeCircularImports(scan);
    expect(findings).toHaveLength(1);
    expect(findings[0].name).toBe('2 files');
  });

  it('does not flag a self-import written as a deferred one', () => {
    const scan = makeScan(['s.ts'], [deferredEdge('s.ts', 's.ts')]);
    expect(computeCircularImports(scan)).toEqual([]);
  });

  it('keeps a larger cycle intact when a deferred edge is a chord across it', () => {
    // The deferred a->c shortcut must not be read as part of the loop, but
    // the eager a->b->c->a cycle is still there and still reportable.
    const scan = makeScan(
      ['a.ts', 'b.ts', 'c.ts'],
      [
        edge('a.ts', 'b.ts', ['b']),
        edge('b.ts', 'c.ts', ['c']),
        edge('c.ts', 'a.ts', ['a']),
        deferredEdge('a.ts', 'c.ts'),
      ],
    );
    const findings = computeCircularImports(scan);
    expect(findings).toHaveLength(1);
    expect(findings[0].name).toBe('3 files');
    // The path must be walkable over eager edges alone.
    expectValidCycle(findings[0].relPath, scan.edges.filter((e) => !e.isDeferred));
  });
});
