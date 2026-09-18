import { describe, expect, it } from 'vitest';
import { annotateTypeRequests, computeTypeOnlyReach } from '../engine/typeOnlyReach';
import type { Edge, ExportFacts, FileNode, ScanResult } from '../types';

function facts(ownNames: string[], typeDeclNames: string[] = []): ExportFacts {
  return {
    ownNames,
    typeDeclNames,
    defaultAggregateNames: [],
    defaultLocalName: null,
    hasExportEquals: false,
  };
}

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

function edge(
  from: string,
  to: string,
  opts: { isDeferred?: boolean; isTypeOnly?: boolean; requestsTypesOnly?: boolean } = {},
): Edge {
  return {
    from,
    to,
    names: '*',
    exposedNames: '*',
    isReexport: false,
    isDeferred: opts.isDeferred ?? false,
    isTypeOnly: opts.isTypeOnly ?? false,
    requestsTypesOnly: opts.requestsTypesOnly ?? false,
    typeOnlyNames: [],
  };
}

function makeScan(
  entries: string[],
  ids: string[],
  edges: Edge[],
  exports: Record<string, ExportFacts> = {},
): ScanResult {
  const nodes: Record<string, FileNode> = {};
  for (const id of ids) {
    nodes[id] = file(id);
    if (exports[id]) nodes[id].exports = exports[id];
  }
  const fanIn: Record<string, number> = {};
  for (const e of edges) fanIn[e.to] = (fanIn[e.to] || 0) + 1;
  return { root: '/proj', entries, nodes, edges, fanIn, warnings: [], coverageGaps: [] };
}

/** A plain `import { ...names }` — no `type` keyword anywhere. */
function named(from: string, to: string, names: string[], isReexport = false): Edge {
  return {
    from,
    to,
    names,
    exposedNames: names,
    isReexport,
    isDeferred: false,
    isTypeOnly: false,
    requestsTypesOnly: false,
    typeOnlyNames: [],
  };
}

describe('computeTypeOnlyReach', () => {
  it('leaves out a file reached by both a type-only and a value path', () => {
    const scan = makeScan(
      ['app/entry.ts'],
      ['app/entry.ts', 'app/a.ts', 'app/b.ts', 'app/shared.ts'],
      [
        edge('app/entry.ts', 'app/a.ts', { isTypeOnly: true }),
        edge('app/a.ts', 'app/shared.ts', { isTypeOnly: true }),
        edge('app/entry.ts', 'app/b.ts'),
        edge('app/b.ts', 'app/shared.ts'),
      ],
    );

    expect(computeTypeOnlyReach(scan).has('app/shared.ts')).toBe(false);
  });

  it('includes a whole chain that sits only behind a type-only edge', () => {
    const scan = makeScan(
      ['app/entry.ts'],
      ['app/entry.ts', 'app/types.ts', 'app/deep.ts'],
      [
        edge('app/entry.ts', 'app/types.ts', { isTypeOnly: true }),
        edge('app/types.ts', 'app/deep.ts'),
      ],
    );

    const typeOnly = computeTypeOnlyReach(scan);
    expect(typeOnly.has('app/types.ts')).toBe(true);
    expect(typeOnly.has('app/deep.ts')).toBe(true);
  });

  it('leaves out a file reached only through a deferred edge — it still runs, later', () => {
    const scan = makeScan(
      ['app/entry.ts'],
      ['app/entry.ts', 'app/lazy.ts'],
      [edge('app/entry.ts', 'app/lazy.ts', { isDeferred: true })],
    );

    expect(computeTypeOnlyReach(scan).has('app/lazy.ts')).toBe(false);
  });

  it('never includes an entry point, even one reached only as a type', () => {
    const scan = makeScan(
      ['app/a.ts', 'app/b.ts'],
      ['app/a.ts', 'app/b.ts'],
      [edge('app/a.ts', 'app/b.ts', { isTypeOnly: true })],
    );

    const typeOnly = computeTypeOnlyReach(scan);
    expect(typeOnly.has('app/a.ts')).toBe(false);
    expect(typeOnly.has('app/b.ts')).toBe(false);
  });
});

describe('annotateTypeRequests', () => {
  const requestsOf = (scan: ScanResult, to: string) =>
    scan.edges.find((e) => e.to === to)!.requestsTypesOnly;

  it('reads a plain import of a name declared as a type as type-only', () => {
    const scan = makeScan(
      ['app/entry.ts'],
      ['app/entry.ts', 'app/types.ts'],
      [named('app/entry.ts', 'app/types.ts', ['SomeType'])],
      { 'app/types.ts': facts(['SomeType'], ['SomeType']) },
    );

    annotateTypeRequests(scan);
    expect(requestsOf(scan, 'app/types.ts')).toBe(true);
    expect(computeTypeOnlyReach(scan).has('app/types.ts')).toBe(true);
  });

  it('needs every requested name to be a type, not just one', () => {
    const scan = makeScan(
      ['app/entry.ts'],
      ['app/entry.ts', 'ui/Button.ts'],
      [named('app/entry.ts', 'ui/Button.ts', ['Button', 'ButtonProps'])],
      { 'ui/Button.ts': facts(['Button', 'ButtonProps'], ['ButtonProps']) },
    );

    annotateTypeRequests(scan);
    expect(requestsOf(scan, 'ui/Button.ts')).toBe(false);
    expect(computeTypeOnlyReach(scan).has('ui/Button.ts')).toBe(false);
  });

  it('follows a name through a barrel to where it is declared', () => {
    const scan = makeScan(
      ['app/entry.ts'],
      ['app/entry.ts', 'shared/index.ts', 'shared/types.ts'],
      [
        named('app/entry.ts', 'shared/index.ts', ['SomeType']),
        named('shared/index.ts', 'shared/types.ts', ['SomeType'], true),
      ],
      {
        'shared/index.ts': facts([]),
        'shared/types.ts': facts(['SomeType'], ['SomeType']),
      },
    );

    annotateTypeRequests(scan);
    const typeOnly = computeTypeOnlyReach(scan);
    expect(typeOnly.has('shared/index.ts')).toBe(true);
    expect(typeOnly.has('shared/types.ts')).toBe(true);
  });

  it('follows a rename across the barrel boundary', () => {
    const forward: Edge = {
      from: 'shared/index.ts',
      to: 'shared/types.ts',
      names: ['Inner'],
      exposedNames: ['Outer'],
      isReexport: true,
      isDeferred: false,
      isTypeOnly: false,
      requestsTypesOnly: false,
      typeOnlyNames: [],
    };
    const scan = makeScan(
      ['app/entry.ts'],
      ['app/entry.ts', 'shared/index.ts', 'shared/types.ts'],
      [named('app/entry.ts', 'shared/index.ts', ['Outer']), forward],
      {
        'shared/index.ts': facts([]),
        'shared/types.ts': facts(['Inner'], ['Inner']),
      },
    );

    annotateTypeRequests(scan);
    expect(requestsOf(scan, 'shared/index.ts')).toBe(true);
  });

  it('cannot answer for a wildcard request, so treats it as a value', () => {
    const scan = makeScan(
      ['app/entry.ts'],
      ['app/entry.ts', 'app/types.ts'],
      [edge('app/entry.ts', 'app/types.ts')],
      { 'app/types.ts': facts(['SomeType'], ['SomeType']) },
    );

    annotateTypeRequests(scan);
    expect(requestsOf(scan, 'app/types.ts')).toBe(false);
  });

  it('treats a name from an unparsed target as a value', () => {
    const scan = makeScan(
      ['app/entry.ts'],
      ['app/entry.ts', 'assets/logo.svg'],
      [named('app/entry.ts', 'assets/logo.svg', ['Logo'])],
    );

    annotateTypeRequests(scan);
    expect(requestsOf(scan, 'assets/logo.svg')).toBe(false);
  });

  it('survives a re-export cycle instead of recursing forever', () => {
    const scan = makeScan(
      ['app/entry.ts'],
      ['app/entry.ts', 'a/index.ts', 'b/index.ts'],
      [
        named('app/entry.ts', 'a/index.ts', ['X']),
        named('a/index.ts', 'b/index.ts', ['X'], true),
        named('b/index.ts', 'a/index.ts', ['X'], true),
      ],
      { 'a/index.ts': facts([]), 'b/index.ts': facts([]) },
    );

    annotateTypeRequests(scan);
    expect(requestsOf(scan, 'a/index.ts')).toBe(false);
  });

  const typeNamesOf = (scan: ScanResult, to: string) =>
    scan.edges.find((e) => e.to === to)!.typeOnlyNames;

  it('keeps the type names of a mixed request the edge flag has to drop', () => {
    const scan = makeScan(
      ['app/entry.ts'],
      ['app/entry.ts', 'stores/user.ts'],
      [named('app/entry.ts', 'stores/user.ts', ['storeUser', 'FilterType'])],
      { 'stores/user.ts': facts(['storeUser', 'FilterType'], ['FilterType']) },
    );

    annotateTypeRequests(scan);
    expect(requestsOf(scan, 'stores/user.ts')).toBe(false);
    expect(typeNamesOf(scan, 'stores/user.ts')).toEqual(['FilterType']);
  });

  it('names a type on the outward side when the barrel renames it', () => {
    const forward: Edge = {
      from: 'shared/index.ts',
      to: 'shared/types.ts',
      names: ['Inner', 'helper'],
      exposedNames: ['Outer', 'helper'],
      isReexport: true,
      isDeferred: false,
      isTypeOnly: false,
      requestsTypesOnly: false,
      typeOnlyNames: [],
    };
    const scan = makeScan(
      ['app/entry.ts'],
      ['app/entry.ts', 'shared/index.ts', 'shared/types.ts'],
      [named('app/entry.ts', 'shared/index.ts', ['Outer']), forward],
      {
        'shared/index.ts': facts([]),
        'shared/types.ts': facts(['Inner', 'helper'], ['Inner']),
      },
    );

    annotateTypeRequests(scan);
    expect(typeNamesOf(scan, 'shared/types.ts')).toEqual(['Outer']);
  });

  it('has no names to give for a wildcard request', () => {
    const scan = makeScan(
      ['app/entry.ts'],
      ['app/entry.ts', 'app/types.ts'],
      [edge('app/entry.ts', 'app/types.ts')],
      { 'app/types.ts': facts(['SomeType'], ['SomeType']) },
    );

    annotateTypeRequests(scan);
    expect(typeNamesOf(scan, 'app/types.ts')).toEqual([]);
  });
});
