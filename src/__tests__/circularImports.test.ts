import { describe, expect, it } from 'vitest';
import { computeCircularImports } from '../engine/circularImports';
import type { Edge, FileNode, Finding, ScanResult } from '../types';

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
    reachedOnlyByTypes: false,
  };
}

function edge(from: string, to: string, names: string[] | '*'): Edge {
  return { from, to, names, exposedNames: names, isReexport: false, isDeferred: false, isTypeOnly: false, requestsTypesOnly: false, typeOnlyNames: [] };
}

/** An import that only runs when a function is called — `lazy(() => import('./x'))`. */
function deferredEdge(from: string, to: string): Edge {
  return { from, to, names: '*', exposedNames: '*', isReexport: false, isDeferred: true, isTypeOnly: false, requestsTypesOnly: false, typeOnlyNames: [] };
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

/**
 * A path is valid when every consecutive pair is a real edge, it closes back
 * on itself, and it starts at the finding's own fileId — the anchor is
 * supposed to be a member of the path it's filed under, not just a label for
 * the component.
 */
function expectValidCycle(finding: Finding, edges: Edge[]): void {
  const ids = finding.relPath.split(' → ');
  expect(ids.length).toBeGreaterThanOrEqual(2);
  expect(ids[0]).toBe(ids[ids.length - 1]);
  expect(ids[0]).toBe(finding.fileId);
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

  it('does not let a self-edge on the anchor short-circuit a multi-file cycle', () => {
    // a<->b is the real 2-file cycle; a also imports itself and is the
    // anchor. A BFS that doesn't skip self-edges finds a->a on its first
    // step and reports "a.ts -> a.ts" under a "2 files" label, dropping b
    // entirely — and with no self-import row to compensate, a being already
    // claimed by the multi-file component.
    const scan = makeScan(
      ['a.ts', 'b.ts'],
      [
        edge('a.ts', 'b.ts', ['b']),
        edge('b.ts', 'a.ts', ['a']),
        edge('a.ts', 'a.ts', ['a']),
      ],
    );
    const findings = computeCircularImports(scan);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      kind: 'circular-import',
      name: '2 files',
      relPath: 'a.ts → b.ts → a.ts',
    });
    expectValidCycle(findings[0], scan.edges);
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
    expectValidCycle(findings[0], scan.edges);
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

  it('gives a group holding two loops one row per loop, not one row for the group', () => {
    // g/a -> g/b -> g/c -> g/a plus g/b <-> g/d makes {a,b,c,d} one strongly
    // connected group of 4. Reported as a group it was one row labelled "4
    // files" whose path named three and left g/d invisible; as loops it is
    // both problems, each whole.
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
    expect(findings.map((f) => [f.name, f.relPath])).toEqual([
      ['2 files', 'g/b.ts → g/d.ts → g/b.ts'],
      ['3 files', 'g/a.ts → g/b.ts → g/c.ts → g/a.ts'],
    ]);
    for (const f of findings) expectValidCycle(f, scan.edges);
  });

  it('names every file it counts, and counts every file it names', () => {
    // The old row counted the strongly connected group while its path walked
    // one cycle inside it, so "4 files" could sit beside a path naming three.
    const scan = makeScan(
      ['a.ts', 'b.ts', 'c.ts', 'd.ts'],
      [
        edge('a.ts', 'b.ts', ['b']),
        edge('b.ts', 'c.ts', ['c']),
        edge('c.ts', 'b.ts', ['b']),
        edge('c.ts', 'd.ts', ['d']),
        edge('d.ts', 'a.ts', ['a']),
      ],
    );
    for (const f of computeCircularImports(scan)) {
      const named = new Set(f.relPath.split(' → ')).size;
      expect(f.name).toBe(`${named} files`);
      expect(f.fileIds).toHaveLength(named);
      expectValidCycle(f, scan.edges);
    }
  });

  it('puts the tightest loops first', () => {
    const scan = makeScan(
      ['a.ts', 'b.ts', 'c.ts', 'd.ts'],
      [
        edge('a.ts', 'b.ts', ['b']),
        edge('b.ts', 'c.ts', ['c']),
        edge('c.ts', 'b.ts', ['b']),
        edge('c.ts', 'd.ts', ['d']),
        edge('d.ts', 'a.ts', ['a']),
      ],
    );
    const findings = computeCircularImports(scan);
    expect(findings.map((f) => f.relPath)).toEqual([
      'b.ts → c.ts → b.ts',
      'a.ts → b.ts → c.ts → d.ts → a.ts',
    ]);
  });

  it('files each row under the first file on its own path', () => {
    const scan = makeScan(
      ['z.ts', 'm.ts', 'a.ts'],
      [edge('z.ts', 'm.ts', ['m']), edge('m.ts', 'a.ts', ['a']), edge('a.ts', 'z.ts', ['z'])],
    );
    const [finding] = computeCircularImports(scan);
    expect(finding.fileId).toBe('a.ts');
    expect(finding.relPath).toBe('a.ts → z.ts → m.ts → a.ts');
  });

  it('reports the same loop once when two statements import the same module', () => {
    // A barrel re-exporting one file twice (a value export plus a type one)
    // is two edges but one import to remove. Printing the loop twice is
    // exactly what a real project produced.
    const scan = makeScan(
      ['barrel.ts', 'Modal.tsx'],
      [
        edge('barrel.ts', 'Modal.tsx', ['Modal']),
        edge('barrel.ts', 'Modal.tsx', ['ModalProps']),
        edge('Modal.tsx', 'barrel.ts', ['Button']),
      ],
    );
    expect(computeCircularImports(scan)).toHaveLength(1);
  });

  it('falls back to one representative row for a group whose every loop is too long to list', () => {
    // A ring of six is a single loop of six files — longer than the default
    // limit of four, so nothing is listed for it loop by loop. It must still
    // produce exactly one row rather than vanishing.
    const ids = Array.from({ length: 6 }, (_, i) => `r${i + 1}.ts`);
    const edges = ids.map((id, i) => edge(id, ids[(i + 1) % ids.length], '*'));
    const findings = computeCircularImports(makeScan(ids, edges));
    expect(findings).toHaveLength(1);
    expect(findings[0].name).toBe('6 files');
    expect(findings[0].reason).toContain('no loop inside it is short enough to list');
    expectValidCycle(findings[0], edges);
  });

  it('lists that same ring loop by loop once the limit is raised past it', () => {
    const ids = Array.from({ length: 6 }, (_, i) => `r${i + 1}.ts`);
    const edges = ids.map((id, i) => edge(id, ids[(i + 1) % ids.length], '*'));
    const findings = computeCircularImports(makeScan(ids, edges), { maxCycleLength: 6 });
    expect(findings).toHaveLength(1);
    expect(findings[0].reason).not.toContain('no loop inside it is short enough');
    expect(findings[0].relPath).toBe('r1.ts → r2.ts → r3.ts → r4.ts → r5.ts → r6.ts → r1.ts');
  });

  it('leaves a loop longer than the limit out while still listing the short ones beside it', () => {
    // a<->b is a 2-loop; a->c->d->e->a is a 4-loop the default limit does
    // list. The 3-file limit here must keep the first and drop the second.
    const scan = makeScan(
      ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts'],
      [
        edge('a.ts', 'b.ts', ['b']),
        edge('b.ts', 'a.ts', ['a']),
        edge('a.ts', 'c.ts', ['c']),
        edge('c.ts', 'd.ts', ['d']),
        edge('d.ts', 'e.ts', ['e']),
        edge('e.ts', 'a.ts', ['a']),
      ],
    );
    expect(computeCircularImports(scan, { maxCycleLength: 3 }).map((f) => f.relPath)).toEqual([
      'a.ts → b.ts → a.ts',
    ]);
    expect(computeCircularImports(scan, { maxCycleLength: 4 }).map((f) => f.relPath)).toEqual([
      'a.ts → b.ts → a.ts',
      'a.ts → c.ts → d.ts → e.ts → a.ts',
    ]);
  });

  it('tells a reader how tangled the group around a loop is', () => {
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
    const [first] = computeCircularImports(scan);
    expect(first.reason).toContain('group of 4 files that all reach each other');
    expect(first.reason).toContain('2 loops of 4 files or fewer were found there');
  });

  it('says nothing about a group when the loop is the whole of it', () => {
    const scan = makeScan(
      ['a.ts', 'b.ts'],
      [edge('a.ts', 'b.ts', ['b']), edge('b.ts', 'a.ts', ['a'])],
    );
    expect(computeCircularImports(scan)[0].reason).toBe(
      'These 2 files import each other in a loop.',
    );
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
    expectValidCycle(findings[0], scan.edges.filter((e) => !e.isDeferred));
  });
});

describe('computeCircularImports — deep chains (stack-depth regression)', () => {
  it('walks a 10,000-link acyclic chain without overflowing the call stack', () => {
    const N = 10000;
    const ids = Array.from({ length: N }, (_, i) => `f${i}.ts`);
    const edges: Edge[] = [];
    for (let i = 0; i < N - 1; i++) edges.push(edge(`f${i}.ts`, `f${i + 1}.ts`, ['x']));
    const scan = makeScan(ids, edges);

    let findings: Finding[] = [];
    expect(() => {
      findings = computeCircularImports(scan);
    }).not.toThrow();
    // No back edge anywhere, so every node is its own trivial component —
    // nothing to report.
    expect(findings).toEqual([]);
  });

  it('still finds the cycle when a 10,000-link chain loops back on itself', () => {
    const N = 10000;
    const ids = Array.from({ length: N }, (_, i) => `f${i}.ts`);
    const edges: Edge[] = [];
    for (let i = 0; i < N - 1; i++) edges.push(edge(`f${i}.ts`, `f${i + 1}.ts`, ['x']));
    edges.push(edge(`f${N - 1}.ts`, 'f0.ts', ['x']));
    const scan = makeScan(ids, edges);

    const findings = computeCircularImports(scan);
    expect(findings).toHaveLength(1);
    // No loop of `maxCycleLength` (default 4) or fewer exists in a pure
    // ring this large, so this is the "no loop short enough to list" row —
    // the whole ring, named through its alphabetically-first file.
    expect(findings[0].fileIds).toHaveLength(N);
    expectValidCycle(findings[0], edges);
  });
});
