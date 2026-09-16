import { describe, expect, it } from 'vitest';
import { buildGraph } from '../engine/buildGraph';
import { edgeKey } from '../utils/edgeKey';
import type { Edge, FileNode, ScanResult } from '../types';
import { layoutGraph } from '../render/client/graph/dagLayout';
import {
  fitsInView,
  importersTitle,
  nearestImporter,
} from '../render/client/graph/graphRenderer';
import { NODE_H, NODE_W } from '../render/client/constants';
import { computeHighlight } from '../render/client/graph/highlight';
import { buildGraphIndex } from '../render/client/graph/types';
import {
  createVisibility,
  hiddenImportCount,
  hiddenImporterCount,
} from '../render/client/graph/visibility';

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
    isDeferred: false,
  };
}

function makeScan(entries: string[], ids: string[], edges: Edge[]): ScanResult {
  const nodes: Record<string, FileNode> = {};
  for (const id of ids) nodes[id] = file(id);
  const fanIn: Record<string, number> = {};
  for (const e of edges) fanIn[e.to] = (fanIn[e.to] || 0) + 1;
  return { root: '/proj', entries, nodes, edges, fanIn, warnings: [], coverageGaps: [] };
}

/**
 * Two features in different branches, both reaching one barrel — the shape
 * the graph view exists for. `a.ts` asks the barrel for `Alpha`, `b.ts`
 * for `Beta`, and the barrel forwards each from its own file.
 */
function sharedBarrelScan(): ScanResult {
  return makeScan(
    ['app/entry.ts'],
    [
      'app/entry.ts',
      'app/a.ts',
      'app/b.ts',
      'ui/index.ts',
      'ui/Alpha.ts',
      'ui/Beta.ts',
    ],
    [
      edge('app/entry.ts', 'app/a.ts', ['A']),
      edge('app/entry.ts', 'app/b.ts', ['B']),
      edge('app/a.ts', 'ui/index.ts', ['Alpha']),
      edge('app/b.ts', 'ui/index.ts', ['Beta']),
      edge('ui/index.ts', 'ui/Alpha.ts', ['default'], {
        isReexport: true,
        exposedNames: ['Alpha'],
      }),
      edge('ui/index.ts', 'ui/Beta.ts', ['default'], {
        isReexport: true,
        exposedNames: ['Beta'],
      }),
    ],
  );
}

/**
 * One shared file with importers at different distances: `app/a.ts` right
 * under the entry, and `deep/mid.ts` down a branch of its own. Whichever
 * route the reader takes in, the other importer is off screen until asked
 * for by name.
 */
function farImportersScan(): ScanResult {
  return makeScan(
    ['app/entry.ts'],
    ['app/entry.ts', 'app/a.ts', 'app/b.ts', 'deep/mid.ts', 'shared/util.ts'],
    [
      edge('app/entry.ts', 'app/a.ts', ['A']),
      edge('app/entry.ts', 'app/b.ts', ['B']),
      edge('app/a.ts', 'shared/util.ts', ['u']),
      edge('app/b.ts', 'deep/mid.ts', ['M']),
      edge('deep/mid.ts', 'shared/util.ts', ['u']),
    ],
  );
}

/** A file that imports itself, which `buildGraph` keeps but counts nowhere. */
function selfImportScan(): ScanResult {
  return makeScan(
    ['app/entry.ts'],
    ['app/entry.ts', 'app/self.ts'],
    [
      edge('app/entry.ts', 'app/self.ts', ['S']),
      edge('app/self.ts', 'app/self.ts', ['S']),
    ],
  );
}

function setUp(scan: ScanResult) {
  const graph = buildGraph(scan);
  const index = buildGraphIndex(graph.nodes, graph.edges);
  return { graph, index, visibility: createVisibility(graph, index) };
}

describe('visibility', () => {
  it('starts with the entry points and what they import, and nothing else', () => {
    const { visibility } = setUp(sharedBarrelScan());
    const visible = visibility.compute();

    expect(visible.nodes.map((n) => n.id).sort()).toEqual([
      'app/a.ts',
      'app/b.ts',
      'app/entry.ts',
    ]);
  });

  it('draws the edge from an importer the reader never opened through', () => {
    // The point of the whole view: open `a` and the barrel appears, along
    // with the line from `b`, which is on screen but still closed. The
    // shared dependency shows without being hunted down the second branch.
    const { visibility } = setUp(sharedBarrelScan());
    visibility.toggle('app/a.ts');
    const visible = visibility.compute();

    expect(visible.nodes.map((n) => n.id)).toContain('ui/index.ts');
    expect(
      visible.edges.some((e) => e.from === 'app/b.ts' && e.to === 'ui/index.ts'),
    ).toBe(true);
  });

  it('keeps a shared node on screen while any of its importers is still open', () => {
    const { visibility } = setUp(sharedBarrelScan());
    visibility.toggle('app/a.ts');
    visibility.toggle('app/b.ts');
    visibility.toggle('app/a.ts');

    expect(visibility.compute().nodes.map((n) => n.id)).toContain('ui/index.ts');
  });

  it('opens the way in when told to reveal a buried file', () => {
    const { visibility } = setUp(sharedBarrelScan());

    expect(visibility.reveal('ui/Beta.ts')).toBe(true);
    const ids = visibility.compute().nodes.map((n) => n.id);
    expect(ids).toContain('ui/Beta.ts');
    // Only the shortest way in is opened — the other branch stays closed.
    expect(visibility.expanded.has('ui/index.ts')).toBe(true);
    expect(visibility.expanded.has('ui/Alpha.ts')).toBe(false);
  });

  it('draws the files importing a node when its fan-in badge is opened', () => {
    // The question a tree cannot answer from the node itself — not "what
    // does this pull in" but "who pulls this in". `deep/mid.ts` sits down a
    // branch the reader never opened, so only this can bring it on screen.
    const { visibility } = setUp(farImportersScan());
    visibility.reveal('shared/util.ts');
    expect(visibility.compute().nodes.map((n) => n.id)).not.toContain(
      'deep/mid.ts',
    );

    visibility.showImporters('shared/util.ts');
    const ids = visibility.compute().nodes.map((n) => n.id);
    expect(ids).toContain('app/a.ts');
    expect(ids).toContain('deep/mid.ts');
  });

  it('follows importers of importers, so opening one can pull in a whole chain', () => {
    const { visibility } = setUp(sharedBarrelScan());
    visibility.collapseAll();
    visibility.showImporters('ui/index.ts');
    visibility.showImporters('app/a.ts');

    // entry -> a -> barrel, reached from the barrel backwards.
    expect(visibility.compute().nodes.map((n) => n.id)).toContain('app/entry.ts');
  });

  it('closes importers again on a second toggle', () => {
    const { visibility } = setUp(farImportersScan());
    visibility.reveal('shared/util.ts');
    visibility.toggleImporters('shared/util.ts');
    expect(visibility.compute().nodes.map((n) => n.id)).toContain('deep/mid.ts');
    visibility.toggleImporters('shared/util.ts');
    expect(visibility.compute().nodes.map((n) => n.id)).not.toContain(
      'deep/mid.ts',
    );
  });

  it('offers the fan-in badge only while a node has importers off screen', () => {
    // `deep/mid.ts` is the importer only the badge can bring on screen, so
    // the shared file gets one. `app/a.ts` does not: its one importer is
    // the entry that opened it, right there — the "1" beside nearly every
    // box that this rule exists to remove.
    const { index, visibility } = setUp(farImportersScan());
    visibility.reveal('shared/util.ts');
    const drawn = () => {
      const ids = new Set(visibility.compute().nodes.map((n) => n.id));
      return (id: string) => ids.has(id);
    };

    expect(hiddenImporterCount('shared/util.ts', index, drawn())).toBe(1);
    expect(hiddenImporterCount('app/a.ts', index, drawn())).toBe(0);

    // Once it has done its work there is nothing left for it to offer.
    visibility.showImporters('shared/util.ts');
    expect(hiddenImporterCount('shared/util.ts', index, drawn())).toBe(0);
  });

  it('drops the badge from a shared node once every importer is drawn', () => {
    // Not only the fan-in-of-one case: both of the barrel's importers are
    // on screen here, and the two lines arriving at it say who they are
    // better than a "2" does.
    const { index, visibility } = setUp(sharedBarrelScan());
    visibility.toggle('app/a.ts');
    const ids = new Set(visibility.compute().nodes.map((n) => n.id));

    expect(ids.has('ui/index.ts')).toBe(true);
    expect(hiddenImporterCount('ui/index.ts', index, (id) => ids.has(id))).toBe(
      0,
    );
  });

  it('does not offer importers for something nothing imports', () => {
    // An entry point has no inbound edges at all, which the badge has to
    // read as "nothing to draw" rather than tripping over the empty list.
    const { index, visibility } = setUp(sharedBarrelScan());
    const ids = new Set(visibility.compute().nodes.map((n) => n.id));

    expect(ids.has('app/entry.ts')).toBe(true);
    expect(
      hiddenImporterCount('app/entry.ts', index, (id) => ids.has(id)),
    ).toBe(0);
  });

  it('has nothing to open once every file a node imports is drawn', () => {
    // Open one branch and the barrel appears. `app/b.ts` imports that same
    // barrel, so there is nothing left for opening `b` to draw — and a
    // click on it should be free to do something else.
    const { index, visibility } = setUp(sharedBarrelScan());
    const drawn = () => {
      const ids = new Set(visibility.compute().nodes.map((n) => n.id));
      return (id: string) => ids.has(id);
    };

    expect(hiddenImportCount('app/b.ts', index, drawn())).toBe(1);
    visibility.toggle('app/a.ts');
    expect(hiddenImportCount('app/b.ts', index, drawn())).toBe(0);
  });

  it('does not count a file importing itself as something to open', () => {
    // The chevron is drawn from `fanOut`, which leaves self-imports out. A
    // node with no chevron must have nothing to open, or a click on it
    // spends a relayout marking it open and no box ever appears.
    const { graph, index, visibility } = setUp(selfImportScan());
    const ids = new Set(visibility.compute().nodes.map((n) => n.id));
    const self = graph.nodes.find((n) => n.id === 'app/self.ts')!;

    expect(self.fanOut).toBe(0);
    expect(index.outEdges['app/self.ts']).toHaveLength(1);
    expect(hiddenImportCount('app/self.ts', index, (id) => ids.has(id))).toBe(0);
  });

  it('never closes the entry points, or the canvas would empty out', () => {
    const { visibility } = setUp(sharedBarrelScan());
    visibility.expandAll();
    visibility.collapseAll();

    expect(visibility.compute().nodes.map((n) => n.id)).toContain('app/entry.ts');
    expect(visibility.isFullyExpanded()).toBe(false);
  });

  it('reports itself fully expanded only when every openable node is open', () => {
    const { visibility } = setUp(sharedBarrelScan());
    expect(visibility.isFullyExpanded()).toBe(false);
    visibility.expandAll();
    expect(visibility.isFullyExpanded()).toBe(true);
    expect(visibility.compute().nodes).toHaveLength(6);
  });

  it('stops reporting itself expanded once a single node is closed again', () => {
    // What the Collapsed/Expanded switch reads after "expand all" followed by
    // one chevron click. The switch is redrawn from this on every refresh, so
    // a stale `true` here is a switch offering to expand what is already open.
    const { visibility } = setUp(sharedBarrelScan());
    visibility.expandAll();
    visibility.toggle('ui/index.ts');

    expect(visibility.isFullyExpanded()).toBe(false);
    // And back, so the switch is not stuck the other way either.
    visibility.toggle('ui/index.ts');
    expect(visibility.isFullyExpanded()).toBe(true);
  });
});

describe('stepping up to an importer', () => {
  /** The visible graph, laid out, keyed the way the renderer keeps it. */
  function laidOut(scan: ScanResult) {
    const { index, visibility } = setUp(scan);
    visibility.expandAll();
    const visible = visibility.compute();
    const nodes = Object.fromEntries(
      layoutGraph(visible.nodes, visible.edges).nodes.map((n) => [n.id, n]),
    );
    return { index, nodes };
  }

  it('walks to the one importer there is', () => {
    const { index, nodes } = laidOut(farImportersScan());
    expect(nearestImporter(nodes['app/a.ts'], index, nodes)?.id).toBe(
      'app/entry.ts',
    );
  });

  it('takes the nearest importer when a file has several', () => {
    // Both are equally true answers to "who imports this", so the one with
    // the shortest edge wins: the line the reader is already looking along.
    const { index, nodes } = laidOut(farImportersScan());
    const util = nodes['shared/util.ts'];
    nodes['app/a.ts'].x = 0;
    nodes['deep/mid.ts'].x = 0;
    util.x = 232;
    util.y = 10;

    nodes['app/a.ts'].y = 0;
    nodes['deep/mid.ts'].y = 500;
    expect(nearestImporter(util, index, nodes)?.id).toBe('app/a.ts');

    nodes['deep/mid.ts'].y = 5;
    expect(nearestImporter(util, index, nodes)?.id).toBe('deep/mid.ts');
  });

  it('ignores importers that are not on the canvas, and stops when none are', () => {
    const { index, nodes } = laidOut(farImportersScan());
    const util = nodes['shared/util.ts'];

    delete nodes['app/a.ts'];
    expect(nearestImporter(util, index, nodes)?.id).toBe('deep/mid.ts');

    delete nodes['deep/mid.ts'];
    expect(nearestImporter(util, index, nodes)).toBeUndefined();
  });

  it('does not step a file importing itself back onto itself', () => {
    const scan = makeScan(
      ['app/entry.ts'],
      ['app/entry.ts', 'app/self.ts'],
      [
        edge('app/entry.ts', 'app/self.ts', ['S']),
        edge('app/self.ts', 'app/self.ts', ['S']),
      ],
    );
    const { index, nodes } = laidOut(scan);
    expect(nearestImporter(nodes['app/self.ts'], index, nodes)?.id).toBe(
      'app/entry.ts',
    );
  });

  describe('deciding whether the step needs a pan', () => {
    // A 1000×600 patch of canvas, in the world coordinates the nodes live in.
    const view = { x0: 0, y0: 0, x1: 1000, y1: 600 };

    it('leaves a node that is comfortably inside where it is', () => {
      expect(fitsInView({ x: 400, y: 300 }, view)).toBe(true);
    });

    it('measures the box, not the anchor point', () => {
      // `x` is the left edge and `y` the centre line: a node whose anchor is
      // inside can still hang out over three of the four sides.
      expect(fitsInView({ x: 1000 - NODE_W, y: 300 }, view)).toBe(true);
      expect(fitsInView({ x: 1000 - NODE_W + 1, y: 300 }, view)).toBe(false);

      expect(fitsInView({ x: 400, y: NODE_H / 2 }, view)).toBe(true);
      expect(fitsInView({ x: 400, y: NODE_H / 2 - 1 }, view)).toBe(false);
      expect(fitsInView({ x: 400, y: 600 - NODE_H / 2 }, view)).toBe(true);
      expect(fitsInView({ x: 400, y: 600 - NODE_H / 2 + 1 }, view)).toBe(false);
    });

    it('calls a node past any edge out of view', () => {
      expect(fitsInView({ x: -1, y: 300 }, view)).toBe(false);
      expect(fitsInView({ x: 4000, y: 300 }, view)).toBe(false);
      expect(fitsInView({ x: 400, y: -800 }, view)).toBe(false);
      expect(fitsInView({ x: 400, y: 900 }, view)).toBe(false);
    });
  });
});

describe('the fan-in badge tooltip', () => {
  it('says which direction it counts, and what clicking will do', () => {
    // A number in a circle is not self-explanatory, and the direction it
    // counts is the one thing this view has that a tree hasn't.
    expect(importersTitle(12, 11, false)).toBe(
      '12 files import this one, 11 of them not on screen — click to draw them',
    );
    expect(importersTitle(12, 12, false)).toBe(
      '12 files import this one — click to draw them',
    );
    expect(importersTitle(12, 0, true)).toBe(
      '12 files import this one — click to put them away again',
    );
  });

  it('counts in whole files, singular and plural', () => {
    expect(importersTitle(1, 1, false)).toBe(
      '1 file imports this one — click to draw it',
    );
    expect(importersTitle(3, 1, false)).toBe(
      '3 files import this one, 1 of them not on screen — click to draw it',
    );
  });
});

describe('highlight', () => {
  it('lights up what an importer reaches through a barrel, and not the rest of it', () => {
    const { index } = setUp(sharedBarrelScan());
    const highlight = computeHighlight('app/a.ts', index);

    expect(highlight.reached.has(edgeKey('ui/index.ts', 'ui/Alpha.ts'))).toBe(true);
    expect(highlight.reached.has(edgeKey('ui/index.ts', 'ui/Beta.ts'))).toBe(false);
    expect(highlight.nodes.has('ui/Alpha.ts')).toBe(true);
    expect(highlight.nodes.has('ui/Beta.ts')).toBe(false);
  });

  it('lights up both sides of the selection — importers as well as imports', () => {
    const { index } = setUp(sharedBarrelScan());
    const highlight = computeHighlight('ui/index.ts', index);

    expect(highlight.nodes.has('app/a.ts')).toBe(true);
    expect(highlight.nodes.has('app/b.ts')).toBe(true);
    expect(highlight.edges.has(edgeKey('app/a.ts', 'ui/index.ts'))).toBe(true);
  });

  it("falls open on a reach the graph can't pin down", () => {
    // `import * as ui from 'ui'` says nothing about which re-exports it
    // touches, so every one of them stays lit rather than none.
    const scan = makeScan(
      ['app/entry.ts'],
      ['app/entry.ts', 'ui/index.ts', 'ui/Alpha.ts'],
      [
        edge('app/entry.ts', 'ui/index.ts', '*'),
        edge('ui/index.ts', 'ui/Alpha.ts', ['default'], {
          isReexport: true,
          exposedNames: ['Alpha'],
        }),
      ],
    );
    const { index } = setUp(scan);
    const highlight = computeHighlight('app/entry.ts', index);

    expect(highlight.reached.has(edgeKey('ui/index.ts', 'ui/Alpha.ts'))).toBe(true);
  });

  it('highlights nothing when nothing is selected', () => {
    const { index } = setUp(sharedBarrelScan());
    expect(computeHighlight(null, index).nodes.size).toBe(0);
  });
});

describe('layout', () => {
  it('gives every node the column its depth says, and keeps rows from overlapping', () => {
    const { graph, visibility } = setUp(sharedBarrelScan());
    visibility.expandAll();
    const visible = visibility.compute();
    const layout = layoutGraph(visible.nodes, visible.edges);

    const byId = Object.fromEntries(layout.nodes.map((n) => [n.id, n]));
    expect(byId['app/entry.ts'].x).toBe(0);
    expect(byId['app/a.ts'].x).toBeGreaterThan(byId['app/entry.ts'].x);
    expect(byId['ui/index.ts'].x).toBeGreaterThan(byId['app/a.ts'].x);
    expect(byId['app/a.ts'].y).not.toBe(byId['app/b.ts'].y);

    // Same column, so their rows have to be far enough apart to draw.
    expect(Math.abs(byId['app/a.ts'].y - byId['app/b.ts'].y)).toBeGreaterThanOrEqual(20);
    expect(graph.nodes).toHaveLength(6);
  });

  it('places a shared node between the importers pulling on it', () => {
    const { visibility } = setUp(sharedBarrelScan());
    visibility.expandAll();
    const visible = visibility.compute();
    const byId = Object.fromEntries(
      layoutGraph(visible.nodes, visible.edges).nodes.map((n) => [n.id, n]),
    );

    const a = byId['app/a.ts'].y;
    const b = byId['app/b.ts'].y;
    const barrel = byId['ui/index.ts'].y;
    expect(barrel).toBeGreaterThanOrEqual(Math.min(a, b));
    expect(barrel).toBeLessThanOrEqual(Math.max(a, b));
  });

  it('measures columns against what is on screen, not against the whole project', () => {
    // `shared/util.ts` is imported straight from the entry AND at the end
    // of a long chain, so its project-wide depth is 3. With only the entry's
    // imports open it belongs in column 1: column 3 would leave two empty
    // columns and a long edge — hundreds of columns on a real project.
    const scan = makeScan(
      ['app/entry.ts'],
      ['app/entry.ts', 'app/a.ts', 'app/b.ts', 'shared/util.ts'],
      [
        edge('app/entry.ts', 'shared/util.ts', ['u']),
        edge('app/entry.ts', 'app/a.ts', ['A']),
        edge('app/a.ts', 'app/b.ts', ['B']),
        edge('app/b.ts', 'shared/util.ts', ['u']),
      ],
    );
    const { graph, visibility } = setUp(scan);
    expect(graph.nodes.find((n) => n.id === 'shared/util.ts')!.depth).toBe(3);

    const visible = visibility.compute();
    const byId = Object.fromEntries(
      layoutGraph(visible.nodes, visible.edges).nodes.map((n) => [n.id, n]),
    );
    expect(byId['shared/util.ts'].x).toBe(byId['app/a.ts'].x);

    // Open the chain and it moves right, because now something visible
    // really is that far upstream of it.
    visibility.expandAll();
    const all = visibility.compute();
    const after = Object.fromEntries(
      layoutGraph(all.nodes, all.edges).nodes.map((n) => [n.id, n]),
    );
    expect(after['shared/util.ts'].x).toBeGreaterThan(after['app/b.ts'].x);
  });

  it('survives a graph with nothing in it', () => {
    expect(layoutGraph([], [])).toEqual({ nodes: [], edges: [] });
  });

  it('lays out a cycle without looping forever', () => {
    const scan = makeScan(
      ['app/a.ts'],
      ['app/a.ts', 'app/b.ts'],
      [edge('app/a.ts', 'app/b.ts', ['B']), edge('app/b.ts', 'app/a.ts', ['A'])],
    );
    const { visibility } = setUp(scan);
    visibility.expandAll();
    const visible = visibility.compute();
    const layout = layoutGraph(visible.nodes, visible.edges);

    expect(layout.nodes).toHaveLength(2);
    expect(layout.edges).toHaveLength(2);
    expect(layout.nodes.every((n) => Number.isFinite(n.y))).toBe(true);
  });
});
