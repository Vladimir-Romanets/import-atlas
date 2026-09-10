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

describe('buildForest — unused occurrence flagging', () => {
  it('flags a barrel re-export that is never requested by name anywhere in the graph', () => {
    const scan = makeScan(
      ['app/entry.ts'],
      ['app/entry.ts', 'components/button/index.ts', 'components/button/Button.ts', 'components/button/IconButton.ts'],
      [
        edge('app/entry.ts', 'components/button/index.ts', ['Button']),
        edge('components/button/index.ts', 'components/button/Button.ts', ['Button'], { isReexport: true }),
        edge('components/button/index.ts', 'components/button/IconButton.ts', ['IconButton'], { isReexport: true }),
      ],
    );

    const forest = buildForest(scan);
    const barrel = findChild(forest, 'components/button/index.ts');
    const button = findChild(barrel.children, 'components/button/Button.ts');
    const iconButton = findChild(barrel.children, 'components/button/IconButton.ts');

    expect(button.unused).toBe(false);
    expect(iconButton.unused).toBe(true);
  });

  it('never flags a plain import, even when the importing file is itself imported elsewhere under an unrelated name (regression)', () => {
    // Mirrors the real-world bug report: a component (Dialog.ts) is imported
    // by name from elsewhere in the app under its own name ('Dialog'), and
    // separately does a completely ordinary `import { resolver } from
    // './validation'`. That plain import must never be hidden just because
    // 'resolver' isn't among the names Dialog.ts itself is requested under.
    const scan = makeScan(
      ['app/root.ts'],
      ['app/root.ts', 'page/Dialog.ts', 'page/validation.ts'],
      [
        edge('app/root.ts', 'page/Dialog.ts', ['Dialog']),
        edge('page/Dialog.ts', 'page/validation.ts', ['resolver']),
      ],
    );

    const forest = buildForest(scan);
    const dialog = findChild(forest, 'page/Dialog.ts');
    const validation = findChild(dialog.children, 'page/validation.ts');

    expect(validation.unused).toBe(false);
  });

  it('follows a renamed re-export chain correctly (regression): consumer imports Alpha, barrel re-exports A as Alpha, which itself re-exports A from impl', () => {
    // consumer -> lib:  import { Alpha } from './lib'
    // lib -> a:         export { A as Alpha } from './a'   (source name 'A', exposed name 'Alpha')
    // a -> impl:        export { A } from './impl'
    //
    // 'A' is what lib actually pulls from a.ts (names, the source side), while
    // 'Alpha' is what lib exposes to its own consumers (exposedNames). Mixing
    // the two up made impl.ts look unrequested even though the whole chain is
    // live: consumer -> lib(Alpha) -> a(A as Alpha) -> impl(A).
    const scan = makeScan(
      ['app/consumer.ts'],
      ['app/consumer.ts', 'app/lib.ts', 'app/a.ts', 'app/impl.ts'],
      [
        edge('app/consumer.ts', 'app/lib.ts', ['Alpha']),
        edge('app/lib.ts', 'app/a.ts', ['A'], { isReexport: true, exposedNames: ['Alpha'] }),
        edge('app/a.ts', 'app/impl.ts', ['A'], { isReexport: true }),
      ],
    );

    const forest = buildForest(scan);
    const lib = findChild(forest, 'app/lib.ts');
    const a = findChild(lib.children, 'app/a.ts');
    const impl = findChild(a.children, 'app/impl.ts');

    expect(a.unused).toBe(false);
    expect(impl.unused).toBe(false);
  });

  it('flags each occurrence per its own parent (per-importer), while still placing the canonical copy on a parent that validly requests it (regression)', () => {
    // entry imports { Foo } from barrel1 and { Shared } from barrel2. barrel1
    // re-exports shared.ts too, but under a name nobody ever asks barrel1
    // for ('Shared' is not among barrel1's own requested names) — that edge
    // is genuinely unused FROM barrel1. barrel2 re-exports the SAME
    // shared.ts under 'Shared', which IS requested of barrel2. "Hide
    // unused" is per-importer: barrel1's occurrence should read as unused
    // (barrel1 doesn't really use it) while barrel2's stays visible — and
    // the canonical (fully expanded) copy must land under barrel2, the
    // parent that actually requests it, so a visible occurrence never
    // points at a hidden one.
    const scan = makeScan(
      ['app/entry.ts'],
      ['app/entry.ts', 'app/barrel1.ts', 'app/barrel2.ts', 'app/shared.ts'],
      [
        edge('app/entry.ts', 'app/barrel1.ts', ['Foo']),
        edge('app/entry.ts', 'app/barrel2.ts', ['Shared']),
        edge('app/barrel1.ts', 'app/shared.ts', ['Shared'], { isReexport: true }),
        edge('app/barrel2.ts', 'app/shared.ts', ['Shared'], { isReexport: true }),
      ],
    );

    const forest = buildForest(scan);
    const barrel1 = findChild(forest, 'app/barrel1.ts');
    const barrel2 = findChild(forest, 'app/barrel2.ts');
    const sharedUnderBarrel1 = findChild(barrel1.children, 'app/shared.ts');
    const canonicalShared = findChild(barrel2.children, 'app/shared.ts');

    expect(canonicalShared.ref).toBeNull();
    expect(canonicalShared.unused).toBe(false);
    expect(sharedUnderBarrel1.ref).not.toBeNull();
    expect(sharedUnderBarrel1.unused).toBe(true);
  });

  it('places the canonical copy of a shared file under a used sibling rather than an unused one visited first (regression)', () => {
    // index re-exports b (exposed as 'IconButton', never requested of index)
    // before a (exposed as 'Button', which IS requested of index). Both a.ts
    // and b.ts plainly import shared.ts, so shared.ts itself is never
    // unused — but if its canonical (fully expanded) copy ends up sitting
    // under b, the "hide unused" viewer toggle prunes b's entire subtree
    // wholesale, including that canonical node, even though shared.ts is
    // genuinely used — and the still-visible `ref` under `a` would point at
    // a node no longer present in the layout.
    const scan = makeScan(
      ['app/entry.ts'],
      ['app/entry.ts', 'app/index.ts', 'app/b.ts', 'app/a.ts', 'app/shared.ts'],
      [
        edge('app/entry.ts', 'app/index.ts', ['Button']),
        edge('app/index.ts', 'app/b.ts', ['IconButton'], { isReexport: true }),
        edge('app/index.ts', 'app/a.ts', ['Button'], { isReexport: true }),
        edge('app/a.ts', 'app/shared.ts', ['helper']),
        edge('app/b.ts', 'app/shared.ts', ['helper']),
      ],
    );

    const forest = buildForest(scan);
    const b = findChild(forest, 'app/b.ts');
    const a = findChild(forest, 'app/a.ts');
    const sharedUnderB = findChild(b.children, 'app/shared.ts');
    const sharedUnderA = findChild(a.children, 'app/shared.ts');

    expect(b.unused).toBe(true);
    expect(a.unused).toBe(false);
    expect(sharedUnderA.ref).toBeNull();
    expect(sharedUnderB.ref).not.toBeNull();
  });

  it('places the canonical copy of a shared file under a used ancestor even when the clean path is in an entirely different branch, not a direct sibling (regression)', () => {
    // entry -> A -> U (unused re-export) -> S
    // entry -> B -> S (plain import)
    // S itself is never unused (B imports it directly), but its only path
    // through A runs via U, which IS unused. Sibling-level reordering alone
    // can't fix this — S isn't a sibling of anything under U, it's U's only
    // child, discovered two levels below A long before entry ever gets to
    // B in a naive single DFS pass. The canonical copy must land under B.
    const scan = makeScan(
      ['app/entry.ts'],
      ['app/entry.ts', 'app/a.ts', 'app/b.ts', 'app/u.ts', 'app/s.ts'],
      [
        edge('app/entry.ts', 'app/a.ts', ['A']),
        edge('app/entry.ts', 'app/b.ts', ['B']),
        edge('app/a.ts', 'app/u.ts', ['Dead'], { isReexport: true }),
        edge('app/u.ts', 'app/s.ts', ['helper']),
        edge('app/b.ts', 'app/s.ts', ['helper']),
      ],
    );

    const forest = buildForest(scan);
    const u = findChild(forest, 'app/u.ts');
    const b = findChild(forest, 'app/b.ts');
    const sUnderU = findChild(u.children, 'app/s.ts');
    const sUnderB = findChild(b.children, 'app/s.ts');

    expect(u.unused).toBe(true);
    expect(sUnderB.ref).toBeNull();
    expect(sUnderB.unused).toBe(false);
    expect(sUnderU.ref).not.toBeNull();
    expect(sUnderU.unused).toBe(false);
  });

  it('hides a file consistently everywhere when it is genuinely unused from every parent that reaches it', () => {
    const scan = makeScan(
      ['app/entry.ts'],
      ['app/entry.ts', 'app/barrel1.ts', 'app/barrel2.ts', 'app/dead.ts'],
      [
        edge('app/entry.ts', 'app/barrel1.ts', ['Foo']),
        edge('app/entry.ts', 'app/barrel2.ts', ['Bar']),
        edge('app/barrel1.ts', 'app/dead.ts', ['Dead'], { isReexport: true }),
        edge('app/barrel2.ts', 'app/dead.ts', ['Dead'], { isReexport: true }),
      ],
    );

    const forest = buildForest(scan);
    const barrel1 = findChild(forest, 'app/barrel1.ts');
    const barrel2 = findChild(forest, 'app/barrel2.ts');
    const canonicalDead = findChild(barrel1.children, 'app/dead.ts');
    const refDead = findChild(barrel2.children, 'app/dead.ts');

    expect(canonicalDead.unused).toBe(true);
    expect(refDead.unused).toBe(true);
  });

  it('never flags a child reached via `export * from` (wildcard re-export)', () => {
    const scan = makeScan(
      ['app/entry.ts'],
      ['app/entry.ts', 'components/button/index.ts', 'components/button/Button.ts'],
      [
        edge('app/entry.ts', 'components/button/index.ts', ['Button']),
        edge('components/button/index.ts', 'components/button/Button.ts', '*', { isReexport: true }),
      ],
    );

    const forest = buildForest(scan);
    const barrel = findChild(forest, 'components/button/index.ts');
    const button = findChild(barrel.children, 'components/button/Button.ts');

    expect(button.unused).toBe(false);
  });

  it('disables filtering entirely once the barrel itself is requested via a namespace import', () => {
    const scan = makeScan(
      ['app/entry.ts'],
      ['app/entry.ts', 'components/button/index.ts', 'components/button/Button.ts', 'components/button/IconButton.ts'],
      [
        edge('app/entry.ts', 'components/button/index.ts', '*'),
        edge('components/button/index.ts', 'components/button/Button.ts', ['Button'], { isReexport: true }),
        edge('components/button/index.ts', 'components/button/IconButton.ts', ['IconButton'], { isReexport: true }),
      ],
    );

    const forest = buildForest(scan);
    const barrel = findChild(forest, 'components/button/index.ts');
    const button = findChild(barrel.children, 'components/button/Button.ts');
    const iconButton = findChild(barrel.children, 'components/button/IconButton.ts');

    expect(button.unused).toBe(false);
    expect(iconButton.unused).toBe(false);
  });

  it('never flags what an entry point re-exports, since nothing in the scan imports the entry itself', () => {
    // `import-atlas graph src/index.ts` on a library: the entry IS the
    // barrel, so no scanned edge points at it and `requestedNames[entry]`
    // stays undefined. Reading that as "none of these names were ever
    // requested" would flag every child and leave "Hide unused" showing an
    // empty tree. The zero-consumer case has to fail safe, not fail closed.
    const scan = makeScan(
      ['src/index.ts'],
      ['src/index.ts', 'src/a.ts', 'src/b.ts'],
      [
        edge('src/index.ts', 'src/a.ts', ['A'], { isReexport: true }),
        edge('src/index.ts', 'src/b.ts', ['B'], { isReexport: true }),
      ],
    );

    const forest = buildForest(scan);
    expect(forest[0].unused).toBe(false);
    expect(forest[0].children.map((c: any) => `${c.fileId}=${c.unused}`)).toEqual([
      'src/a.ts=false',
      'src/b.ts=false',
    ]);
  });

  it('preserves the existing dupe-import hint', () => {
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

  it('preserves circular-import ref/warn handling', () => {
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
    expect(backEdge.warn).toBe('circular import');
  });
});

describe('buildForest — known limit of per-edge unused', () => {
  it('documents a known limit: `unused` narrows per direct edge only, not per full entry-to-node path (regression coverage, not a bug)', () => {
    // entry imports Button from the barrel; a sibling page imports IconButton
    // from the SAME barrel. `components/button/index.ts` itself is deduped
    // to one canonical occurrence (that's the whole point of canonical/ref —
    // a barrel with hundreds of importers must not get hundreds of full
    // copies of its subtree). Because there's only one physical place in the
    // tree where index.ts's children live, IconButton.ts's `unused` reflects
    // "was IconButton requested of index.ts by ANY of index.ts's own
    // parents" — it can't additionally narrow to "...specifically via the
    // entry->index.ts edge", since that would require a second, differently
    // filtered copy of index.ts's subtree to exist. Per-edge unused fixes
    // direct multi-parent fan-in (see the barrel1/barrel2 test above); it
    // does not make "hide unused" fully per-path for a barrel reached
    // through many different plain-import consumers.
    const scan = makeScan(
      ['app/entry.ts'],
      ['app/entry.ts', 'app/other-page.ts', 'components/button/index.ts', 'components/button/IconButton.ts'],
      [
        edge('app/entry.ts', 'components/button/index.ts', ['Button']),
        edge('app/entry.ts', 'app/other-page.ts', ['OtherPage']),
        edge('app/other-page.ts', 'components/button/index.ts', ['IconButton']),
        edge('components/button/index.ts', 'components/button/IconButton.ts', ['IconButton'], { isReexport: true }),
      ],
    );

    const forest = buildForest(scan);
    const iconButtonUnderEntry = findChild(findChild(forest, 'components/button/index.ts').children, 'components/button/IconButton.ts');

    // Requested somewhere (other-page), so shown as used — even while
    // viewing the entry->index.ts path, which on its own never asked for it.
    expect(iconButtonUnderEntry.unused).toBe(false);
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
        edge('app/entry.ts', 'app/barrel1.ts', ['Foo']),
        edge('app/entry.ts', 'app/barrel2.ts', ['Bar']),
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

describe('buildForest — unused flagging under incomplete scan coverage', () => {
  /** The one graph from the first test: IconButton is genuinely unused when everything is read. */
  const barrelGraph = (coverageGaps: string[]) =>
    makeScan(
      ['app/entry.ts'],
      ['app/entry.ts', 'components/button/index.ts', 'components/button/Button.ts', 'components/button/IconButton.ts'],
      [
        edge('app/entry.ts', 'components/button/index.ts', ['Button']),
        edge('components/button/index.ts', 'components/button/Button.ts', ['Button'], { isReexport: true }),
        edge('components/button/index.ts', 'components/button/IconButton.ts', ['IconButton'], { isReexport: true }),
      ],
      coverageGaps,
    );

  function unusedFlags(scan: ReturnType<typeof barrelGraph>): boolean[] {
    const out: boolean[] = [];
    const walk = (n: any) => {
      out.push(n.unused);
      n.children.forEach(walk);
    };
    buildForest(scan).forEach(walk);
    return out;
  }

  it('flags nothing once the walk reports a coverage gap', () => {
    // On this exact graph a complete scan flags IconButton — that's the
    // first test in this file. A gap has to withhold the verdict instead.
    const gapped = barrelGraph(['the --max-files cap (2) stopped the walk with 7 file(s) still unread']);
    expect(unusedFlags(gapped).some(Boolean)).toBe(false);
  });
});
