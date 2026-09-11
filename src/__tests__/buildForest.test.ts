import { describe, expect, it } from 'vitest';
import { buildForest } from '../buildForest';
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

/** Edge fixture builder — `exposedNames` defaults to `names` (no rename) unless overridden. */
function edge(
  from: string,
  to: string,
  names: string[] | '*',
  opts: { isReexport?: boolean; exposedNames?: string[] | '*' } = {},
): Edge {
  return {
    from,
    to,
    names,
    exposedNames: opts.exposedNames ?? names,
    isReexport: opts.isReexport ?? false,
  };
}

function makeScan(
  entries: string[],
  ids: string[],
  edges: Edge[],
  coverageGaps: string[] = [],
): ScanResult {
  const nodes: Record<string, FileNode> = {};
  for (const id of ids) nodes[id] = file(id);
  const fanIn: Record<string, number> = {};
  for (const e of edges) fanIn[e.to] = (fanIn[e.to] || 0) + 1;
  return { root: '/proj', entries, nodes, edges, fanIn, warnings: [], coverageGaps };
}

function findChild(nodes: { fileId: string; children: any[] }[], fileId: string): any {
  for (const n of nodes) {
    if (n.fileId === fileId) return n;
    const found = findChild(n.children, fileId);
    if (found) return found;
  }
  return undefined;
}

describe('buildForest — hints and cycles', () => {
  it('collapses repeated edges to one child and calls the repetition out in the parent hint', () => {
    const scan = makeScan(
      ['app/entry.ts'],
      ['app/entry.ts', 'app/utils.ts'],
      [
        edge('app/entry.ts', 'app/utils.ts', ['helper']),
        edge('app/entry.ts', 'app/utils.ts', ['type Helper']),
      ],
    );
    const forest = buildForest(scan);
    expect(forest[0].hint).toMatch(/utils/);
  });

  it('turns a back-edge to a file on the current path into a ref flagged as a circular import', () => {
    const scan = makeScan(
      ['app/a.ts'],
      ['app/a.ts', 'app/b.ts'],
      [
        edge('app/a.ts', 'app/b.ts', ['b']),
        edge('app/b.ts', 'app/a.ts', ['a']),
      ],
    );
    const forest = buildForest(scan);
    const b = findChild(forest, 'app/b.ts');
    const backEdge = findChild(b.children, 'app/a.ts');
    expect(backEdge.ref).not.toBeNull();
    expect(backEdge.warn).toBe('circular import — see Findings tab for the full cycle');
  });
});

describe('buildForest — importedAs (the viewer\'s primary node label)', () => {
  it('reflects the outward/exposed name of the specific edge that reached this occurrence, not the raw name pulled internally', () => {
    // lib re-exports a's export under a different outward name ('Alpha')
    // than what it pulls from a internally ('A') — the viewer should show
    // "Alpha" (what consumers recognize), not "A" (a's own internal name).
    const scan = makeScan(
      ['app/consumer.ts'],
      ['app/consumer.ts', 'app/lib.ts', 'app/a.ts'],
      [
        edge('app/consumer.ts', 'app/lib.ts', ['Alpha']),
        edge('app/lib.ts', 'app/a.ts', ['A'], { isReexport: true, exposedNames: ['Alpha'] }),
      ],
    );

    const forest = buildForest(scan);
    const lib = findChild(forest, 'app/lib.ts');
    const a = findChild(lib.children, 'app/a.ts');

    expect(lib.importedAs).toEqual(['Alpha']);
    expect(a.importedAs).toEqual(['Alpha']);
  });

  it('falls back to "*" for a root entry point (no parent edge to derive a name from)', () => {
    const scan = makeScan(['app/entry.ts'], ['app/entry.ts'], []);
    const forest = buildForest(scan);
    expect(forest[0].importedAs).toBe('*');
  });

  it('falls back to "*" when the edge names are undeterminable (namespace import)', () => {
    const scan = makeScan(
      ['app/entry.ts'],
      ['app/entry.ts', 'app/utils.ts'],
      [edge('app/entry.ts', 'app/utils.ts', '*')],
    );
    const forest = buildForest(scan);
    const utils = findChild(forest, 'app/utils.ts');
    expect(utils.importedAs).toBe('*');
  });

  it('shows different importedAs per occurrence for the same file reached under different names', () => {
    const scan = makeScan(
      ['app/entry.ts'],
      ['app/entry.ts', 'app/barrel1.ts', 'app/barrel2.ts', 'app/shared.ts'],
      [
        edge('app/entry.ts', 'app/barrel1.ts', ['One']),
        edge('app/entry.ts', 'app/barrel2.ts', ['Two']),
        edge('app/barrel1.ts', 'app/shared.ts', ['One'], { isReexport: true, exposedNames: ['One'] }),
        edge('app/barrel2.ts', 'app/shared.ts', ['Two'], { isReexport: true, exposedNames: ['Two'] }),
      ],
    );

    const forest = buildForest(scan);
    const barrel1 = findChild(forest, 'app/barrel1.ts');
    const barrel2 = findChild(forest, 'app/barrel2.ts');
    const sharedUnderBarrel1 = findChild(barrel1.children, 'app/shared.ts');
    const sharedUnderBarrel2 = findChild(barrel2.children, 'app/shared.ts');

    expect(sharedUnderBarrel1.importedAs).toEqual(['One']);
    expect(sharedUnderBarrel2.importedAs).toEqual(['Two']);
  });
});

/** Every renderId the client sees, in forest order. */
function allRenderIds(nodes: any[]): string[] {
  const out: string[] = [];
  const walk = (n: any) => {
    out.push(n.renderId);
    n.children.forEach(walk);
  };
  nodes.forEach(walk);
  return out;
}

describe('buildForest — entry points own their canonical position', () => {
  it('keeps an entry imported by an earlier entry as its own expanded root', () => {
    const scan = makeScan(
      ['app/a.ts', 'app/b.ts'],
      ['app/a.ts', 'app/b.ts', 'app/c.ts'],
      [edge('app/a.ts', 'app/b.ts', ['B']), edge('app/b.ts', 'app/c.ts', ['C'])],
    );

    const forest = buildForest(scan);
    expect(forest).toHaveLength(2);

    const rootB = forest[1];
    expect(rootB.fileId).toBe('app/b.ts');
    expect(rootB.ref).toBeNull();
    expect(rootB.children.map((c: any) => c.fileId)).toEqual(['app/c.ts']);

    // b under a is a compact ref back to that root, not the root object itself.
    const bUnderA = forest[0].children[0];
    expect(bUnderA.fileId).toBe('app/b.ts');
    expect(bUnderA).not.toBe(rootB);
    expect(bUnderA.ref).toBe(rootB.renderId);
    expect(bUnderA.children).toEqual([]);

    // The ref needs an id of its own: the client indexes nodes by renderId
    // and looks them up with `[data-id]`, so a repeat makes it toggle,
    // focus and scroll to whichever copy it happens to find.
    const ids = allRenderIds(forest);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('collapses a file listed twice as an entry into a single root', () => {
    const scan = makeScan(
      ['app/a.ts', 'app/a.ts'],
      ['app/a.ts', 'app/dep.ts'],
      [edge('app/a.ts', 'app/dep.ts', ['Dep'])],
    );

    const forest = buildForest(scan);
    expect(forest).toHaveLength(1);
    const ids = allRenderIds(forest);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('still gives a shared non-entry file one expansion and refs elsewhere', () => {
    const scan = makeScan(
      ['app/a.ts', 'app/b.ts'],
      ['app/a.ts', 'app/b.ts', 'app/shared.ts'],
      [edge('app/a.ts', 'app/shared.ts', ['S']), edge('app/b.ts', 'app/shared.ts', ['S'])],
    );

    const forest = buildForest(scan);
    const underA = forest[0].children[0];
    const underB = forest[1].children[0];

    expect(underA.ref).toBeNull();
    expect(underB.ref).toBe(underA.renderId);
    const ids = allRenderIds(forest);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('buildForest — a barrel shows what its importer asked for', () => {
  /** entry imports `Button`; another page imports `IconButton`; both go through one barrel. */
  const twoConsumers = () =>
    makeScan(
      ['app/entry.ts'],
      ['app/entry.ts', 'app/page.ts', 'ui/index.ts', 'ui/Button.ts', 'ui/IconButton.ts'],
      [
        edge('app/entry.ts', 'ui/index.ts', ['Button']),
        edge('app/entry.ts', 'app/page.ts', ['Page']),
        edge('app/page.ts', 'ui/index.ts', ['IconButton']),
        edge('ui/index.ts', 'ui/Button.ts', ['Button'], { isReexport: true }),
        edge('ui/index.ts', 'ui/IconButton.ts', ['IconButton'], { isReexport: true }),
      ],
    );

  it('drops the re-exports the importer never asked for', () => {
    const forest = buildForest(twoConsumers());
    const barrelUnderEntry = findChild(forest, 'ui/index.ts');

    expect(barrelUnderEntry.children.map((c: any) => c.fileId)).toEqual(['ui/Button.ts']);
  });

  it('gives a second importer its own expansion rather than a ref to the first one\'s children', () => {
    const forest = buildForest(twoConsumers());
    const barrelUnderEntry = findChild(forest, 'ui/index.ts');
    const page = findChild(forest, 'app/page.ts');
    const barrelUnderPage = findChild(page.children, 'ui/index.ts');

    // Two real expansions of the same file, each scoped to its own request.
    expect(barrelUnderEntry.ref).toBeNull();
    expect(barrelUnderPage.ref).toBeNull();
    expect(barrelUnderPage.renderId).not.toBe(barrelUnderEntry.renderId);
    expect(barrelUnderPage.children.map((c: any) => c.fileId)).toEqual(['ui/IconButton.ts']);
  });

  it('still collapses two importers that ask for the same thing into one expansion', () => {
    const scan = makeScan(
      ['app/entry.ts'],
      ['app/entry.ts', 'app/page.ts', 'ui/index.ts', 'ui/Button.ts'],
      [
        edge('app/entry.ts', 'ui/index.ts', ['Button']),
        edge('app/entry.ts', 'app/page.ts', ['Page']),
        edge('app/page.ts', 'ui/index.ts', ['Button']),
        edge('ui/index.ts', 'ui/Button.ts', ['Button'], { isReexport: true }),
      ],
    );

    const forest = buildForest(scan);
    const underEntry = findChild(forest, 'ui/index.ts');
    const underPage = findChild(findChild(forest, 'app/page.ts').children, 'ui/index.ts');

    expect(underEntry.ref).toBeNull();
    expect(underPage.ref).toBe(underEntry.renderId);
  });

  it('matches on the outward name a renamed re-export offers, not the one it pulls', () => {
    const scan = makeScan(
      ['app/entry.ts'],
      ['app/entry.ts', 'ui/index.ts', 'ui/impl.ts'],
      [
        edge('app/entry.ts', 'ui/index.ts', ['Alpha']),
        edge('ui/index.ts', 'ui/impl.ts', ['A'], { isReexport: true, exposedNames: ['Alpha'] }),
      ],
    );

    const barrel = findChild(buildForest(scan), 'ui/index.ts');
    expect(barrel.children.map((c: any) => c.fileId)).toEqual(['ui/impl.ts']);
  });

  it('narrows nothing when the barrel is pulled wholesale by a namespace import', () => {
    const scan = makeScan(
      ['app/entry.ts'],
      ['app/entry.ts', 'ui/index.ts', 'ui/Button.ts', 'ui/IconButton.ts'],
      [
        edge('app/entry.ts', 'ui/index.ts', '*'),
        edge('ui/index.ts', 'ui/Button.ts', ['Button'], { isReexport: true }),
        edge('ui/index.ts', 'ui/IconButton.ts', ['IconButton'], { isReexport: true }),
      ],
    );

    const barrel = findChild(buildForest(scan), 'ui/index.ts');
    expect(barrel.children).toHaveLength(2);
  });

  it('keeps a child reached by `export * from`, whose forwarded names are unknown', () => {
    const scan = makeScan(
      ['app/entry.ts'],
      ['app/entry.ts', 'ui/index.ts', 'ui/Button.ts', 'ui/IconButton.ts'],
      [
        edge('app/entry.ts', 'ui/index.ts', ['Button']),
        edge('ui/index.ts', 'ui/Button.ts', ['Button'], { isReexport: true }),
        edge('ui/index.ts', 'ui/IconButton.ts', '*', { isReexport: true, exposedNames: '*' }),
      ],
    );

    const barrel = findChild(buildForest(scan), 'ui/index.ts');
    expect(barrel.children.map((c: any) => c.fileId)).toEqual([
      'ui/Button.ts',
      'ui/IconButton.ts',
    ]);
  });

  it('keeps what the barrel imports outright, which is its own usage rather than a forwarded name', () => {
    const scan = makeScan(
      ['app/entry.ts'],
      ['app/entry.ts', 'ui/index.ts', 'ui/Button.ts', 'ui/styles.ts'],
      [
        edge('app/entry.ts', 'ui/index.ts', ['Button']),
        edge('ui/index.ts', 'ui/Button.ts', ['Button'], { isReexport: true }),
        edge('ui/index.ts', 'ui/styles.ts', '*'),
      ],
    );

    const barrel = findChild(buildForest(scan), 'ui/index.ts');
    expect(barrel.children.map((c: any) => c.fileId)).toContain('ui/styles.ts');
  });

  it('shows an entry point that is itself a barrel in full, since nothing in the scan asks it for anything', () => {
    const scan = makeScan(
      ['ui/index.ts'],
      ['ui/index.ts', 'ui/Button.ts', 'ui/IconButton.ts'],
      [
        edge('ui/index.ts', 'ui/Button.ts', ['Button'], { isReexport: true }),
        edge('ui/index.ts', 'ui/IconButton.ts', ['IconButton'], { isReexport: true }),
      ],
    );

    expect(buildForest(scan)[0].children).toHaveLength(2);
  });

  it('does not split a plain (non-barrel) file per importer, since its contents do not depend on the request', () => {
    const scan = makeScan(
      ['app/entry.ts'],
      ['app/entry.ts', 'app/page.ts', 'app/utils.ts'],
      [
        edge('app/entry.ts', 'app/utils.ts', ['one']),
        edge('app/entry.ts', 'app/page.ts', ['Page']),
        edge('app/page.ts', 'app/utils.ts', ['two']),
      ],
    );

    const forest = buildForest(scan);
    const underEntry = findChild(forest, 'app/utils.ts');
    const underPage = findChild(findChild(forest, 'app/page.ts').children, 'app/utils.ts');

    expect(underEntry.ref).toBeNull();
    expect(underPage.ref).toBe(underEntry.renderId);
  });

  it('narrows through a chain of barrels, carrying the request the outer one forwards', () => {
    const scan = makeScan(
      ['app/entry.ts'],
      ['app/entry.ts', 'ui/index.ts', 'ui/button/index.ts', 'ui/button/Button.ts', 'ui/button/IconButton.ts'],
      [
        edge('app/entry.ts', 'ui/index.ts', ['Button']),
        edge('ui/index.ts', 'ui/button/index.ts', ['Button'], { isReexport: true }),
        edge('ui/button/index.ts', 'ui/button/Button.ts', ['Button'], { isReexport: true }),
        edge('ui/button/index.ts', 'ui/button/IconButton.ts', ['IconButton'], { isReexport: true }),
      ],
    );

    const inner = findChild(buildForest(scan), 'ui/button/index.ts');
    expect(inner.children.map((c: any) => c.fileId)).toEqual(['ui/button/Button.ts']);
  });

  it('flags a cycle back into a barrel occurrence still being expanded', () => {
    const scan = makeScan(
      ['app/entry.ts'],
      ['app/entry.ts', 'ui/index.ts', 'ui/Button.ts'],
      [
        edge('app/entry.ts', 'ui/index.ts', ['Button']),
        edge('ui/index.ts', 'ui/Button.ts', ['Button'], { isReexport: true }),
        edge('ui/Button.ts', 'ui/index.ts', ['Button']),
      ],
    );

    const barrel = findChild(buildForest(scan), 'ui/index.ts');
    const backEdge = findChild(findChild(barrel.children, 'ui/Button.ts').children, 'ui/index.ts');

    expect(backEdge.warn).toBe('circular import — see Findings tab for the full cycle');
    expect(backEdge.ref).toBe(barrel.renderId);
  });
});
