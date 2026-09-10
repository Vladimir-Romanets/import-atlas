import { describe, expect, it } from 'vitest';
import { computeFindings } from '../findings';
import type { Edge, ExportFacts, FileNode, ScanResult } from '../types';

function facts(partial: Partial<ExportFacts> = {}): ExportFacts {
  return {
    ownNames: [],
    defaultAggregateNames: [],
    defaultLocalName: null,
    hasExportEquals: false,
    ...partial,
  };
}

function file(id: string, exports: ExportFacts | null): FileNode {
  return {
    id,
    absPath: `/proj/${id}`,
    relPath: id,
    label: id.split('/').pop()!.replace(/\.ts$/, ''),
    layer: id.split('/')[0],
    externalImports: [],
    unresolvedImports: [],
    exports,
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
  files: Record<string, ExportFacts | null>,
  edges: Edge[],
  coverageGaps: string[] = [],
): ScanResult {
  const nodes: Record<string, FileNode> = {};
  for (const [id, exports] of Object.entries(files)) nodes[id] = file(id, exports);
  const fanIn: Record<string, number> = {};
  for (const e of edges) fanIn[e.to] = (fanIn[e.to] || 0) + 1;
  return { root: '/proj', entries, nodes, edges, fanIn, warnings: [], coverageGaps };
}

const names = (findings: { name: string }[]): string[] => findings.map((f) => f.name);

describe('computeFindings — exports nothing imports', () => {
  it('flags an exported name no file asks for', () => {
    const scan = makeScan(
      ['app/entry.ts'],
      {
        'app/entry.ts': facts({ ownNames: ['app'] }),
        'utils/strings.ts': facts({ ownNames: ['leftPad', 'isBlank'] }),
      },
      [edge('app/entry.ts', 'utils/strings.ts', ['leftPad'])],
    );

    const findings = computeFindings(scan);
    expect(names(findings)).toEqual(['isBlank']);
    expect(findings[0]).toMatchObject({
      kind: 'dead-export',
      fileId: 'utils/strings.ts',
      relPath: 'utils/strings.ts',
      layer: 'utils',
      confidence: 'high',
    });
    expect(findings[0].recommendation).toBeTruthy();
  });

  it('never flags an entry point, whose consumers are outside the scan by definition', () => {
    const scan = makeScan(
      ['app/entry.ts'],
      { 'app/entry.ts': facts({ ownNames: ['app', 'bootstrap'] }) },
      [],
    );
    expect(computeFindings(scan)).toEqual([]);
  });

  it('flags nothing in a file some importer pulled wholesale (namespace, dynamic import, require)', () => {
    const scan = makeScan(
      ['app/entry.ts'],
      {
        'app/entry.ts': facts({ ownNames: ['app'] }),
        'utils/strings.ts': facts({ ownNames: ['leftPad', 'isBlank'] }),
      },
      [edge('app/entry.ts', 'utils/strings.ts', '*')],
    );
    expect(computeFindings(scan)).toEqual([]);
  });

  it('flags nothing in a file reached by `export * from`, whose forwarded names are unknowable', () => {
    const scan = makeScan(
      ['app/entry.ts'],
      {
        'app/entry.ts': facts({ ownNames: ['app'] }),
        'ui/index.ts': facts(),
        'ui/Button.ts': facts({ ownNames: ['Button', 'ButtonProps'] }),
      },
      [
        edge('app/entry.ts', 'ui/index.ts', ['Button']),
        edge('ui/index.ts', 'ui/Button.ts', '*', { isReexport: true, exposedNames: '*' }),
      ],
    );
    expect(computeFindings(scan)).toEqual([]);
  });

  it('skips a file that was never parsed rather than reading "no exports" as "nothing is used"', () => {
    const scan = makeScan(
      ['app/entry.ts'],
      { 'app/entry.ts': facts({ ownNames: ['app'] }), 'assets/logo.svg': null },
      [edge('app/entry.ts', 'assets/logo.svg', '*')],
    );
    expect(computeFindings(scan)).toEqual([]);
  });

  it('skips a file using `export =`, whose named exports cannot be matched', () => {
    const scan = makeScan(
      ['app/entry.ts'],
      {
        'app/entry.ts': facts({ ownNames: ['app'] }),
        'legacy/api.ts': facts({ ownNames: ['request', 'post'], hasExportEquals: true }),
      },
      [edge('app/entry.ts', 'legacy/api.ts', ['request'])],
    );
    expect(computeFindings(scan)).toEqual([]);
  });
});

describe('computeFindings — confidence', () => {
  it('lowers to medium when the name merely duplicates the imported default export', () => {
    const scan = makeScan(
      ['app/entry.ts'],
      {
        'app/entry.ts': facts({ ownNames: ['app'] }),
        'page/LoginPage.ts': facts({
          ownNames: ['LoginPage', 'default'],
          defaultLocalName: 'LoginPage',
        }),
      },
      [edge('app/entry.ts', 'page/LoginPage.ts', ['default'])],
    );

    const findings = computeFindings(scan);
    expect(names(findings)).toEqual(['LoginPage']);
    expect(findings[0].confidence).toBe('medium');
  });

  it('lowers to low when the name is carried by the imported default object, which hides property access', () => {
    const scan = makeScan(
      ['app/entry.ts'],
      {
        'app/entry.ts': facts({ ownNames: ['app'] }),
        'utils/strings.ts': facts({
          ownNames: ['leftPad', 'isBlank', 'default'],
          defaultAggregateNames: ['leftPad', 'isBlank'],
          defaultLocalName: 'StringUtils',
        }),
      },
      [edge('app/entry.ts', 'utils/strings.ts', ['default'])],
    );

    const findings = computeFindings(scan);
    expect(names(findings)).toEqual(['isBlank', 'leftPad']);
    expect(findings.every((f) => f.confidence === 'low')).toBe(true);
  });

  it('keeps full confidence when the default itself is never imported, so the object cannot be hiding anything', () => {
    const scan = makeScan(
      ['app/entry.ts'],
      {
        'app/entry.ts': facts({ ownNames: ['app'] }),
        'utils/strings.ts': facts({
          ownNames: ['leftPad', 'isBlank', 'default'],
          defaultAggregateNames: ['leftPad', 'isBlank'],
          defaultLocalName: 'StringUtils',
        }),
      },
      [edge('app/entry.ts', 'utils/strings.ts', ['leftPad'])],
    );

    const findings = computeFindings(scan);
    expect(names(findings)).toEqual(['default', 'isBlank']);
    expect(findings.every((f) => f.confidence === 'high')).toBe(true);
  });

  it('sorts most-trustworthy first, then by path and name', () => {
    const scan = makeScan(
      ['app/entry.ts'],
      {
        'app/entry.ts': facts({ ownNames: ['app'] }),
        'a/dup.ts': facts({ ownNames: ['Dup', 'default'], defaultLocalName: 'Dup' }),
        'b/dead.ts': facts({ ownNames: ['Gone'] }),
      },
      [
        edge('app/entry.ts', 'a/dup.ts', ['default']),
        edge('app/entry.ts', 'b/dead.ts', ['Used']),
      ],
    );

    expect(computeFindings(scan).map((f) => [f.name, f.confidence])).toEqual([
      ['Gone', 'high'],
      ['Dup', 'medium'],
    ]);
  });
});

describe('computeFindings — barrel re-exports', () => {
  it('flags a re-exported name nothing imports from the barrel', () => {
    const scan = makeScan(
      ['app/entry.ts'],
      {
        'app/entry.ts': facts({ ownNames: ['app'] }),
        'ui/index.ts': facts(),
        'ui/Button.ts': facts({ ownNames: ['Button'] }),
        'ui/IconButton.ts': facts({ ownNames: ['IconButton'] }),
      },
      [
        edge('app/entry.ts', 'ui/index.ts', ['Button']),
        edge('ui/index.ts', 'ui/Button.ts', ['Button'], { isReexport: true }),
        edge('ui/index.ts', 'ui/IconButton.ts', ['IconButton'], { isReexport: true }),
      ],
    );

    const findings = computeFindings(scan);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      kind: 'dead-reexport',
      fileId: 'ui/index.ts',
      name: 'IconButton',
      confidence: 'high',
    });
  });

  it('judges a renamed re-export by the outward name it offers, not the one it pulls', () => {
    const scan = makeScan(
      ['app/entry.ts'],
      {
        'app/entry.ts': facts({ ownNames: ['app'] }),
        'ui/index.ts': facts(),
        'ui/impl.ts': facts({ ownNames: ['A'] }),
      },
      [
        edge('app/entry.ts', 'ui/index.ts', ['Alpha']),
        edge('ui/index.ts', 'ui/impl.ts', ['A'], { isReexport: true, exposedNames: ['Alpha'] }),
      ],
    );
    expect(computeFindings(scan)).toEqual([]);
  });

  it('reports a name once even when several statements re-export it', () => {
    const scan = makeScan(
      ['app/entry.ts'],
      {
        'app/entry.ts': facts({ ownNames: ['app'] }),
        'ui/index.ts': facts(),
        'ui/a.ts': facts({ ownNames: ['Shared'] }),
        'ui/b.ts': facts({ ownNames: ['Shared'] }),
      },
      [
        edge('app/entry.ts', 'ui/index.ts', ['Used']),
        edge('ui/index.ts', 'ui/a.ts', ['Shared'], { isReexport: true }),
        edge('ui/index.ts', 'ui/b.ts', ['Shared'], { isReexport: true }),
      ],
    );

    const reexports = computeFindings(scan).filter((f) => f.kind === 'dead-reexport');
    expect(reexports).toHaveLength(1);
    expect(reexports[0].name).toBe('Shared');
  });

  it('still reports when the walk admits coverage gaps — a list is reviewable, unlike a hidden node', () => {
    const scan = makeScan(
      ['app/entry.ts'],
      {
        'app/entry.ts': facts({ ownNames: ['app'] }),
        'utils/strings.ts': facts({ ownNames: ['leftPad', 'isBlank'] }),
      },
      [edge('app/entry.ts', 'utils/strings.ts', ['leftPad'])],
      ['the --max-files cap (10) stopped the walk with 3 file(s) still unread'],
    );
    expect(names(computeFindings(scan))).toEqual(['isBlank']);
  });
});
