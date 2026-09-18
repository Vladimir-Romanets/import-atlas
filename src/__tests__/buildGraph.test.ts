import { describe, expect, it } from 'vitest';
import { buildGraph } from '../engine/buildGraph';
import type { Edge, FileNode, GraphData, ScanResult } from '../types';

function file(id: string, externalImports: string[] = []): FileNode {
  return {
    id,
    absPath: `/proj/${id}`,
    relPath: id,
    label: id.split('/').pop()!.replace(/\.ts$/, ''),
    layer: id.split('/')[0],
    externalImports,
    unresolvedImports: [],
    exports: null,
    reachedOnlyByTypes: false,
  };
}

/** Edge fixture builder — `exposedNames` defaults to `names` (no rename) unless overridden. */
function edge(
  from: string,
  to: string,
  names: string[] | '*',
  opts: {
    isReexport?: boolean;
    isDeferred?: boolean;
    isTypeOnly?: boolean;
    requestsTypesOnly?: boolean;
    exposedNames?: string[] | '*';
  } = {},
): Edge {
  return {
    from,
    to,
    names,
    exposedNames: opts.exposedNames ?? names,
    isReexport: opts.isReexport ?? false,
    isDeferred: opts.isDeferred ?? false,
    isTypeOnly: opts.isTypeOnly ?? false,
    requestsTypesOnly: opts.requestsTypesOnly ?? false,
    typeOnlyNames: [],
  };
}

function makeScan(entries: string[], ids: string[], edges: Edge[]): ScanResult {
  const nodes: Record<string, FileNode> = {};
  for (const id of ids) nodes[id] = file(id);
  const fanIn: Record<string, number> = {};
  for (const e of edges) fanIn[e.to] = (fanIn[e.to] || 0) + 1;
  return { root: '/proj', entries, nodes, edges, fanIn, warnings: [], coverageGaps: [] };
}

const nodeOf = (graph: GraphData, id: string) =>
  graph.nodes.find((n) => n.id === id)!;
const edgeOf = (graph: GraphData, from: string, to: string) =>
  graph.edges.find((e) => e.from === from && e.to === to)!;

describe('buildGraph — merging', () => {
  it('draws a file reached from several places once, with an edge from each importer', () => {
    const graph = buildGraph(
      makeScan(
        ['app/entry.ts'],
        ['app/entry.ts', 'app/a.ts', 'app/b.ts', 'shared/index.ts'],
        [
          edge('app/entry.ts', 'app/a.ts', ['A']),
          edge('app/entry.ts', 'app/b.ts', ['B']),
          edge('app/a.ts', 'shared/index.ts', ['a']),
          edge('app/b.ts', 'shared/index.ts', ['b']),
        ],
      ),
    );

    expect(graph.nodes.filter((n) => n.id === 'shared/index.ts')).toHaveLength(1);
    expect(nodeOf(graph, 'shared/index.ts').fanIn).toBe(2);
    expect(
      graph.edges.filter((e) => e.to === 'shared/index.ts').map((e) => e.from),
    ).toEqual(['app/a.ts', 'app/b.ts']);
  });

  it('keeps a barrel whole rather than splitting it per request, and carries each reach on its own edge', () => {
    const graph = buildGraph(
      makeScan(
        ['app/entry.ts'],
        ['app/entry.ts', 'app/a.ts', 'app/b.ts', 'ui/index.ts', 'ui/Button.ts', 'ui/Card.ts'],
        [
          edge('app/entry.ts', 'app/a.ts', ['A']),
          edge('app/entry.ts', 'app/b.ts', ['B']),
          edge('app/a.ts', 'ui/index.ts', ['Button']),
          edge('app/b.ts', 'ui/index.ts', ['Card']),
          edge('ui/index.ts', 'ui/Button.ts', ['default'], {
            isReexport: true,
            exposedNames: ['Button'],
          }),
          edge('ui/index.ts', 'ui/Card.ts', ['default'], {
            isReexport: true,
            exposedNames: ['Card'],
          }),
        ],
      ),
    );

    expect(graph.nodes.filter((n) => n.id === 'ui/index.ts')).toHaveLength(1);
    // Both re-exports stay children of the one barrel node...
    expect(nodeOf(graph, 'ui/index.ts').fanOut).toBe(2);
    // ...and which importer reaches which is on the edges, for the viewer
    // to highlight.
    expect(edgeOf(graph, 'app/a.ts', 'ui/index.ts').names).toEqual(['Button']);
    expect(edgeOf(graph, 'ui/index.ts', 'ui/Button.ts').exposedNames).toEqual(['Button']);
  });

  it('collapses repeated statements between one pair into a single edge', () => {
    const graph = buildGraph(
      makeScan(
        ['app/entry.ts'],
        ['app/entry.ts', 'app/utils.ts'],
        [
          edge('app/entry.ts', 'app/utils.ts', ['helper']),
          edge('app/entry.ts', 'app/utils.ts', ['Helper']),
        ],
      ),
    );

    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0].statements).toBe(2);
    expect(graph.edges[0].mergeableStatements).toBe(2);
    expect(graph.edges[0].names).toEqual(['helper', 'Helper']);
    // Two statements, still one importer — that repetition belongs to the
    // edge, not to the node's fan-in.
    expect(nodeOf(graph, 'app/utils.ts').fanIn).toBe(1);
  });

  it('treats a pair as deferred only when every statement linking it is', () => {
    const graph = buildGraph(
      makeScan(
        ['app/entry.ts'],
        ['app/entry.ts', 'app/lazy.ts', 'app/mixed.ts'],
        [
          edge('app/entry.ts', 'app/lazy.ts', '*', { isDeferred: true }),
          edge('app/entry.ts', 'app/mixed.ts', '*', { isDeferred: true }),
          edge('app/entry.ts', 'app/mixed.ts', ['now']),
        ],
      ),
    );

    expect(edgeOf(graph, 'app/entry.ts', 'app/lazy.ts').isDeferred).toBe(true);
    expect(edgeOf(graph, 'app/entry.ts', 'app/mixed.ts').isDeferred).toBe(false);
  });

  it('leaves deferred statements out of the mergeable count', () => {
    // The counts `computeDupeImports` reaches for the same three pairs (see
    // `dupeImports.test.ts`). The viewer's duplicate warning reads this
    // field, so anything it flags has a Findings row waiting.
    const graph = buildGraph(
      makeScan(
        ['app/routes.ts'],
        ['app/routes.ts', 'app/Page.ts', 'app/Both.ts', 'app/Lazy.ts'],
        [
          // A type import beside a lazy one: two statements, nothing to merge.
          edge('app/routes.ts', 'app/Page.ts', ['Props']),
          edge('app/routes.ts', 'app/Page.ts', '*', { isDeferred: true }),
          // Two static statements that a deferred third doesn't add to.
          edge('app/routes.ts', 'app/Both.ts', ['x']),
          edge('app/routes.ts', 'app/Both.ts', ['y']),
          edge('app/routes.ts', 'app/Both.ts', '*', { isDeferred: true }),
          edge('app/routes.ts', 'app/Lazy.ts', '*', { isDeferred: true }),
          edge('app/routes.ts', 'app/Lazy.ts', '*', { isDeferred: true }),
        ],
      ),
    );

    const page = edgeOf(graph, 'app/routes.ts', 'app/Page.ts');
    expect(page.statements).toBe(2);
    expect(page.mergeableStatements).toBe(1);

    const both = edgeOf(graph, 'app/routes.ts', 'app/Both.ts');
    expect(both.statements).toBe(3);
    expect(both.mergeableStatements).toBe(2);

    const lazy = edgeOf(graph, 'app/routes.ts', 'app/Lazy.ts');
    expect(lazy.statements).toBe(2);
    expect(lazy.mergeableStatements).toBe(0);
  });

  it('treats a pair as type-only only when every statement linking it is', () => {
    const graph = buildGraph(
      makeScan(
        ['app/entry.ts'],
        ['app/entry.ts', 'app/types.ts', 'app/mixed.ts'],
        [
          edge('app/entry.ts', 'app/types.ts', ['Props'], { isTypeOnly: true }),
          edge('app/entry.ts', 'app/mixed.ts', ['Props'], { isTypeOnly: true }),
          edge('app/entry.ts', 'app/mixed.ts', ['value']),
        ],
      ),
    );

    expect(edgeOf(graph, 'app/entry.ts', 'app/types.ts').isTypeOnly).toBe(true);
    expect(edgeOf(graph, 'app/entry.ts', 'app/mixed.ts').isTypeOnly).toBe(false);
  });

  it("keeps '*' absorbing when merging the names of parallel statements", () => {
    const graph = buildGraph(
      makeScan(
        ['app/entry.ts'],
        ['app/entry.ts', 'app/utils.ts'],
        [
          edge('app/entry.ts', 'app/utils.ts', ['helper']),
          edge('app/entry.ts', 'app/utils.ts', '*'),
        ],
      ),
    );

    expect(graph.edges[0].names).toBe('*');
  });
});

describe('buildGraph — depth', () => {
  it('measures a node from its furthest importer, not its nearest', () => {
    // entry imports shared directly AND through a three-file chain. By
    // shortest path it would come out at 1, upstream of files importing it.
    const graph = buildGraph(
      makeScan(
        ['app/entry.ts'],
        ['app/entry.ts', 'app/a.ts', 'app/b.ts', 'shared/util.ts'],
        [
          edge('app/entry.ts', 'shared/util.ts', ['u']),
          edge('app/entry.ts', 'app/a.ts', ['A']),
          edge('app/a.ts', 'app/b.ts', ['B']),
          edge('app/b.ts', 'shared/util.ts', ['u']),
        ],
      ),
    );

    expect(nodeOf(graph, 'app/entry.ts').depth).toBe(0);
    expect(nodeOf(graph, 'app/a.ts').depth).toBe(1);
    expect(nodeOf(graph, 'app/b.ts').depth).toBe(2);
    expect(nodeOf(graph, 'shared/util.ts').depth).toBe(3);
    expect(graph.maxDepth).toBe(3);
  });

  it('lays several entry points out on one canvas, sharing what they share', () => {
    const graph = buildGraph(
      makeScan(
        ['app/one.ts', 'app/two.ts'],
        ['app/one.ts', 'app/two.ts', 'shared/util.ts'],
        [
          edge('app/one.ts', 'shared/util.ts', ['u']),
          edge('app/two.ts', 'shared/util.ts', ['u']),
        ],
      ),
    );

    expect(graph.nodes.filter((n) => n.isEntry).map((n) => n.id)).toEqual([
      'app/one.ts',
      'app/two.ts',
    ]);
    expect(graph.nodes.filter((n) => n.id === 'shared/util.ts')).toHaveLength(1);
    expect(nodeOf(graph, 'shared/util.ts').fanIn).toBe(2);
  });

  it('sorts nodes shallowest-first so the layout starts from a stable order', () => {
    const graph = buildGraph(
      makeScan(
        ['app/entry.ts'],
        ['app/entry.ts', 'app/a.ts', 'app/b.ts', 'app/deep.ts'],
        [
          edge('app/entry.ts', 'app/a.ts', ['A']),
          edge('app/entry.ts', 'app/b.ts', ['B']),
          edge('app/a.ts', 'app/deep.ts', ['D']),
        ],
      ),
    );

    expect(graph.nodes.map((n) => n.id)).toEqual([
      'app/entry.ts',
      'app/a.ts',
      'app/b.ts',
      'app/deep.ts',
    ]);
  });
});

describe('buildGraph — cycles', () => {
  it('marks the edge that closes a loop, and leaves the rest pointing forwards', () => {
    const graph = buildGraph(
      makeScan(
        ['app/entry.ts'],
        ['app/entry.ts', 'app/a.ts', 'app/b.ts'],
        [
          edge('app/entry.ts', 'app/a.ts', ['A']),
          edge('app/a.ts', 'app/b.ts', ['B']),
          edge('app/b.ts', 'app/a.ts', ['A']),
        ],
      ),
    );

    expect(edgeOf(graph, 'app/a.ts', 'app/b.ts').isBackEdge).toBe(false);
    expect(edgeOf(graph, 'app/b.ts', 'app/a.ts').isBackEdge).toBe(true);
    // The cut is what lets the rest be laid out in columns at all.
    expect(nodeOf(graph, 'app/a.ts').depth).toBe(1);
    expect(nodeOf(graph, 'app/b.ts').depth).toBe(2);
  });

  it('marks a self-import as a back edge without letting it affect columns', () => {
    const graph = buildGraph(
      makeScan(
        ['app/entry.ts'],
        ['app/entry.ts', 'app/self.ts'],
        [
          edge('app/entry.ts', 'app/self.ts', ['S']),
          edge('app/self.ts', 'app/self.ts', ['S']),
        ],
      ),
    );

    expect(edgeOf(graph, 'app/self.ts', 'app/self.ts').isBackEdge).toBe(true);
    expect(nodeOf(graph, 'app/self.ts').depth).toBe(1);
    // A self-import is nobody else's import: it must not inflate fan-in.
    expect(nodeOf(graph, 'app/self.ts').fanIn).toBe(1);
  });

  it('lays out a graph whose every node sits on a cycle', () => {
    const graph = buildGraph(
      makeScan(
        ['app/a.ts'],
        ['app/a.ts', 'app/b.ts', 'app/c.ts'],
        [
          edge('app/a.ts', 'app/b.ts', ['B']),
          edge('app/b.ts', 'app/c.ts', ['C']),
          edge('app/c.ts', 'app/a.ts', ['A']),
        ],
      ),
    );

    expect(graph.nodes.map((n) => n.depth)).toEqual([0, 1, 2]);
    expect(graph.edges.filter((e) => e.isBackEdge)).toHaveLength(1);
  });
});

describe('buildGraph — robustness', () => {
  it('drops an edge whose endpoint the scan never turned into a node', () => {
    const scan = makeScan(
      ['app/entry.ts'],
      ['app/entry.ts'],
      [edge('app/entry.ts', 'app/never-read.ts', ['X'])],
    );
    const graph = buildGraph(scan);

    expect(graph.edges).toHaveLength(0);
    expect(graph.nodes).toHaveLength(1);
  });

  it('handles a long import chain without recursing on it', () => {
    const ids = Array.from({ length: 20000 }, (_, i) => `app/f${i}.ts`);
    const edges = ids.slice(1).map((id, i) => edge(ids[i], id, ['X']));
    const graph = buildGraph(makeScan([ids[0]], ids, edges));

    expect(graph.maxDepth).toBe(19999);
    expect(nodeOf(graph, ids[19999]).depth).toBe(19999);
  });
});
