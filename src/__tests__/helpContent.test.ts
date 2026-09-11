import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { computeFindings } from '../findings';
import { computeCircularImports } from '../circularImports';
import { computeDupeImports } from '../dupeImports';
import type { Edge, ExportFacts, FileNode, Finding, ScanResult } from '../types';

/**
 * The findings list looks its help fragment up by group key
 * (`src/render/client/findings.ts` — `HELP_HTML[group.key]`) and simply omits
 * the `?` icon when the lookup misses. That failure is silent: no throw, no
 * console warning, just a section a reader can't get an explanation for. These
 * tests pin the two halves of the contract together — the keys the detector
 * can emit, and the fragment filenames on disk.
 *
 * They read the `.html` sources rather than importing
 * `helpContent.generated.ts`, which is git-ignored and, in CI, not yet written
 * when the suite runs (`pnpm test` precedes `pnpm run build`).
 */
const HELP_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'render',
  'client',
  'help',
);

/** Mirrors how the viewer derives a group key from a finding. */
const groupKey = (finding: Finding): string => `${finding.kind}-${finding.confidence}`;

/**
 * Every group the findings list documents today. The fixture below is asserted
 * against this set, so a new kind or confidence tier fails here first and its
 * author has to extend the fixture — which is what makes the two tests after
 * it cover the new group too.
 */
const DOCUMENTED_GROUPS = [
  'circular-import-high',
  'dead-export-high',
  'dead-export-low',
  'dead-export-medium',
  'dead-reexport-high',
  'dupe-import-high',
];

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

function edge(
  from: string,
  to: string,
  names: string[] | '*',
  opts: { isReexport?: boolean } = {},
): Edge {
  return { from, to, names, exposedNames: names, isReexport: opts.isReexport ?? false };
}

/**
 * One scan that trips every group at once: an export nobody asks for (high), a
 * barrel forwarding a name nobody asks it for (high), a name duplicating the
 * imported default (medium), names carried by an imported default object
 * (low), a pair of files that import each other in a loop, and a pair linked
 * by two separate import statements.
 */
function scanCoveringEveryGroup(): ScanResult {
  const files: Record<string, ExportFacts | null> = {
    'app/entry.ts': facts({ ownNames: ['app'] }),
    'utils/strings.ts': facts({ ownNames: ['leftPad', 'isBlank'] }),
    'page/LoginPage.ts': facts({ ownNames: ['LoginPage', 'default'], defaultLocalName: 'LoginPage' }),
    'utils/aggregate.ts': facts({
      ownNames: ['trim', 'pad', 'default'],
      defaultAggregateNames: ['trim', 'pad'],
      defaultLocalName: 'Utils',
    }),
    'ui/index.ts': facts(),
    'ui/Button.ts': facts({ ownNames: ['Button'] }),
    'ui/IconButton.ts': facts({ ownNames: ['IconButton'] }),
    'cycle/a.ts': facts(),
    'cycle/b.ts': facts(),
  };
  const edges: Edge[] = [
    edge('app/entry.ts', 'utils/strings.ts', ['leftPad']),
    // Two statements pulling `leftPad` from the same file — trips dupe-import.
    edge('app/entry.ts', 'utils/strings.ts', ['leftPad']),
    edge('app/entry.ts', 'page/LoginPage.ts', ['default']),
    edge('app/entry.ts', 'utils/aggregate.ts', ['default']),
    edge('app/entry.ts', 'ui/index.ts', ['Button']),
    edge('ui/index.ts', 'ui/Button.ts', ['Button'], { isReexport: true }),
    edge('ui/index.ts', 'ui/IconButton.ts', ['IconButton'], { isReexport: true }),
    // Mutual import — trips circular-import.
    edge('cycle/a.ts', 'cycle/b.ts', ['b']),
    edge('cycle/b.ts', 'cycle/a.ts', ['a']),
  ];

  const nodes: Record<string, FileNode> = {};
  for (const [id, exports] of Object.entries(files)) nodes[id] = file(id, exports);
  const fanIn: Record<string, number> = {};
  for (const e of edges) fanIn[e.to] = (fanIn[e.to] || 0) + 1;
  return { root: '/proj', entries: ['app/entry.ts'], nodes, edges, fanIn, warnings: [], coverageGaps: [] };
}

const emittedGroups = (): string[] => [
  ...new Set([
    ...computeFindings(scanCoveringEveryGroup()).map(groupKey),
    ...computeCircularImports(scanCoveringEveryGroup()).map(groupKey),
    ...computeDupeImports(scanCoveringEveryGroup()).map(groupKey),
  ]),
].sort();

const helpSlugs = (): string[] =>
  fs
    .readdirSync(HELP_DIR)
    .filter((name) => name.endsWith('.html'))
    .map((name) => name.slice(0, -'.html'.length))
    .sort();

describe('findings help fragments', () => {
  it('exercises every documented group from a single fixture', () => {
    expect(emittedGroups()).toEqual(DOCUMENTED_GROUPS);
  });

  it('ships a fragment for every group the detector can emit', () => {
    const slugs = new Set(helpSlugs());
    expect(emittedGroups().filter((key) => !slugs.has(key))).toEqual([]);
  });

  it('ships no fragment that no group would ever look up', () => {
    const groups = new Set(emittedGroups());
    expect(helpSlugs().filter((slug) => !groups.has(slug))).toEqual([]);
  });

  it('gives every fragment content to show', () => {
    for (const slug of helpSlugs()) {
      const html = fs.readFileSync(path.join(HELP_DIR, `${slug}.html`), 'utf8').trim();
      expect(html, slug).not.toBe('');
      // The modal injects the fragment with innerHTML on the strength of it
      // being developer-authored and static; a <script> here would mean that
      // assumption slipped.
      expect(html, slug).not.toMatch(/<script/i);
    }
  });
});
