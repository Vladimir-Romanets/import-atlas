import { describe, expect, it } from 'vitest';
import { computeDupeImports } from '../dupeImports';
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

describe('computeDupeImports', () => {
  it('finds nothing when every pair is linked by a single statement', () => {
    const scan = makeScan(
      ['a.ts', 'b.ts', 'c.ts'],
      [edge('a.ts', 'b.ts', ['b']), edge('a.ts', 'c.ts', ['c'])],
    );
    expect(computeDupeImports(scan)).toEqual([]);
  });

  it('flags a pair linked by two statements', () => {
    const scan = makeScan(
      ['app/entry.ts', 'ui/Button.ts'],
      [edge('app/entry.ts', 'ui/Button.ts', ['Button']), edge('app/entry.ts', 'ui/Button.ts', ['default'])],
    );
    const findings = computeDupeImports(scan);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      kind: 'dupe-import',
      fileId: 'app/entry.ts',
      relPath: 'app/entry.ts',
      name: 'Button (×2)',
      confidence: 'high',
    });
  });

  it('counts three statements between the same pair as ×3', () => {
    const scan = makeScan(
      ['a.ts', 'b.ts'],
      [edge('a.ts', 'b.ts', ['x']), edge('a.ts', 'b.ts', ['y']), edge('a.ts', 'b.ts', ['z'])],
    );
    expect(computeDupeImports(scan)[0].name).toBe('b (×3)');
  });

  it('reports separate findings for separate duplicated pairs, not merged into one', () => {
    const scan = makeScan(
      ['a.ts', 'b.ts', 'c.ts'],
      [
        edge('a.ts', 'b.ts', ['x']),
        edge('a.ts', 'b.ts', ['y']),
        edge('a.ts', 'c.ts', ['x']),
        edge('a.ts', 'c.ts', ['y']),
      ],
    );
    expect(computeDupeImports(scan)).toHaveLength(2);
  });

  it('does not conflate pairs sharing only a `from` or only a `to`', () => {
    const scan = makeScan(
      ['a.ts', 'b.ts', 'c.ts'],
      [
        // a -> b twice (dupe), a -> c once, b -> c once: only the a->b pair
        // should be flagged, even though c is a `to` for two different
        // importers and a is a `from` for two different targets.
        edge('a.ts', 'b.ts', ['x']),
        edge('a.ts', 'b.ts', ['y']),
        edge('a.ts', 'c.ts', ['x']),
        edge('b.ts', 'c.ts', ['x']),
      ],
    );
    const findings = computeDupeImports(scan);
    expect(findings).toHaveLength(1);
    expect(findings[0].relPath).toBe('a.ts');
    expect(findings[0].name).toBe('b (×2)');
  });

  it('does not count a deferred import against a static one from the same file', () => {
    // The route-split shape: `import type { Props } from './Page'` next to
    // `lazy(() => import('./Page'))`. Two statements, but merging them is
    // exactly what must not happen — it would undo the code splitting.
    const scan = makeScan(
      ['app/routes.ts', 'app/Page.ts'],
      [edge('app/routes.ts', 'app/Page.ts', ['Props']), deferredEdge('app/routes.ts', 'app/Page.ts')],
    );
    expect(computeDupeImports(scan)).toEqual([]);
  });

  it('does not flag a pair linked only by several deferred imports', () => {
    const scan = makeScan(
      ['a.ts', 'b.ts'],
      [deferredEdge('a.ts', 'b.ts'), deferredEdge('a.ts', 'b.ts')],
    );
    expect(computeDupeImports(scan)).toEqual([]);
  });

  it('still flags two static statements when a deferred one also links the pair', () => {
    const scan = makeScan(
      ['a.ts', 'b.ts'],
      [
        edge('a.ts', 'b.ts', ['x']),
        edge('a.ts', 'b.ts', ['y']),
        deferredEdge('a.ts', 'b.ts'),
      ],
    );
    // ×2, not ×3: the deferred one isn't a statement that could be merged in.
    expect(computeDupeImports(scan)[0].name).toBe('b (×2)');
  });
});
