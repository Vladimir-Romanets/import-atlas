import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { computeLayerViolations } from '../engine/layerViolations';
import { discoverLayers, validateLayerRules } from '../engine/layerRules';
import type { Edge, FileNode, ScanResult } from '../types';
import type { LayerRules } from '../engine/layerRules';

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

function edge(from: string, to: string): Edge {
  return { from, to, names: '*', exposedNames: '*', isReexport: false, isDeferred: false, isTypeOnly: false, requestsTypesOnly: false, typeOnlyNames: [] };
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

describe('computeLayerViolations', () => {
  it('never flags an import within the same layer, whatever the rules', () => {
    const scan = makeScan(['ui/Button.ts', 'ui/Icon.ts'], [edge('ui/Button.ts', 'ui/Icon.ts')]);
    expect(computeLayerViolations(scan, {})).toEqual([]);
  });

  it('allows a cross-layer import when the source layer is "*"', () => {
    const scan = makeScan(['app/entry.ts', 'shared/util.ts'], [edge('app/entry.ts', 'shared/util.ts')]);
    const rules: LayerRules = { app: '*' };
    expect(computeLayerViolations(scan, rules)).toEqual([]);
  });

  it('allows a cross-layer import listed in the source layer\'s allowlist', () => {
    const scan = makeScan(['app/entry.ts', 'shared/util.ts'], [edge('app/entry.ts', 'shared/util.ts')]);
    const rules: LayerRules = { app: ['shared'] };
    expect(computeLayerViolations(scan, rules)).toEqual([]);
  });

  it('flags a cross-layer import not listed in the source layer\'s allowlist', () => {
    const scan = makeScan(['app/entry.ts', 'widgets/Card.ts'], [edge('app/entry.ts', 'widgets/Card.ts')]);
    const rules: LayerRules = { app: ['shared'] };
    const findings = computeLayerViolations(scan, rules);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      kind: 'layer-violation',
      fileId: 'app/entry.ts',
      fileIds: ['app/entry.ts', 'widgets/Card.ts'],
      relPath: 'app/entry.ts',
      layer: 'app',
      name: 'widgets/Card.ts',
      confidence: 'high',
    });
  });

  it('flags a cross-layer import when the source layer has no key in the rules', () => {
    const scan = makeScan(['app/entry.ts', 'shared/util.ts'], [edge('app/entry.ts', 'shared/util.ts')]);
    expect(computeLayerViolations(scan, {})).toHaveLength(1);
  });

  it('flags a cross-layer import when the source layer is listed with []', () => {
    const scan = makeScan(['app/entry.ts', 'shared/util.ts'], [edge('app/entry.ts', 'shared/util.ts')]);
    const rules: LayerRules = { app: [] };
    expect(computeLayerViolations(scan, rules)).toHaveLength(1);
  });

  it('flags a deferred cross-layer import just like a static one', () => {
    const scan = makeScan(
      ['app/entry.ts', 'widgets/Card.ts'],
      [deferredEdge('app/entry.ts', 'widgets/Card.ts')],
    );
    const rules: LayerRules = { app: ['shared'] };
    expect(computeLayerViolations(scan, rules)).toHaveLength(1);
  });

  it('reports one finding per (importer, target file) pair, not collapsed per layer pair', () => {
    const scan = makeScan(
      ['app/entry.ts', 'widgets/Card.ts', 'widgets/List.ts'],
      [edge('app/entry.ts', 'widgets/Card.ts'), edge('app/entry.ts', 'widgets/List.ts')],
    );
    const findings = computeLayerViolations(scan, {});
    expect(findings).toHaveLength(2);
  });

  it('collapses several statements pulling from the same target into one finding', () => {
    // A value import plus a separate type-only import of the same module
    // produces two edges between the same (from, to) pair — one violation,
    // not two.
    const scan = makeScan(
      ['app/entry.ts', 'widgets/Card.ts'],
      [edge('app/entry.ts', 'widgets/Card.ts'), edge('app/entry.ts', 'widgets/Card.ts')],
    );
    const findings = computeLayerViolations(scan, {});
    expect(findings).toHaveLength(1);
  });
});

describe('validateLayerRules', () => {
  function scanWithLayers(...layers: string[]): ScanResult {
    return makeScan(layers.map((l) => `${l}/x.ts`), []);
  }

  it('warns about a rules key naming a layer the scan never saw', () => {
    const scan = scanWithLayers('app');
    const warnings = validateLayerRules(scan, { app: '*', legacy: '*' });
    expect(warnings).toEqual(["layer-rules file mentions unknown layer 'legacy' — no scanned file belongs to it."]);
  });

  it('warns about a real layer missing from the rules', () => {
    const scan = scanWithLayers('app', 'shared');
    const warnings = validateLayerRules(scan, { app: '*' });
    expect(warnings).toEqual([
      "layer 'shared' has no rule in the layer-rules file — it defaults to importing from no other layer.",
    ]);
  });

  it('warns about an allowlist entry naming a layer the scan never saw', () => {
    const scan = scanWithLayers('app', 'shared');
    const warnings = validateLayerRules(scan, { app: ['shred'], shared: '*' });
    expect(warnings).toEqual([
      "layer-rules file allows 'app' to import from unknown layer 'shred' — no scanned file belongs to it.",
    ]);
  });

  it('warns about nothing when the rules exactly match the scan', () => {
    const scan = scanWithLayers('app', 'shared');
    expect(validateLayerRules(scan, { app: '*', shared: '*' })).toEqual([]);
  });
});

describe('discoverLayers', () => {
  let root: string;

  afterEach(() => {
    if (root) fs.rmSync(root, { recursive: true, force: true });
  });

  /** Creates each directory with one source file inside, which is what makes it a layer. */
  function mkdirs(...relDirs: string[]): void {
    for (const rel of relDirs) {
      fs.mkdirSync(path.join(root, rel), { recursive: true });
      fs.writeFileSync(path.join(root, rel, 'index.ts'), '');
    }
  }

  /** Creates each directory with no source file in it — a `docs/`, a `public/`. */
  function mkEmptyDirs(...relDirs: string[]): void {
    for (const rel of relDirs) fs.mkdirSync(path.join(root, rel), { recursive: true });
  }

  it('lists the immediate children of src/ when it exists', () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-'));
    mkdirs('src/app', 'src/features', 'src/shared');
    expect(discoverLayers(root)).toEqual(['app', 'features', 'shared']);
  });

  it('skips dot-directories and common tooling directories', () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-'));
    mkdirs(
      'src/app',
      'src/__tests__',
      'src/__mocks__',
      'src/.storybook',
      'src/node_modules',
      'src/dist',
      'src/build',
      'src/out',
      'src/coverage'
    );
    expect(discoverLayers(root)).toEqual(['app']);
  });

  it('includes "(root)" when a file sits directly in src/', () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-'));
    mkdirs('src/app');
    fs.writeFileSync(path.join(root, 'src/proxy.ts'), '');
    expect(discoverLayers(root)).toEqual(['(root)', 'app']);
  });

  it('lists the top-level directories of a project that has no src/ at all', () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-'));
    mkdirs('packages/a', 'packages/b');
    expect(discoverLayers(root)).toEqual(['packages']);
  });

  it('also picks up a top-level directory that sits beside src/', () => {
    // `layerOf` only strips a leading `src/` — a file under a sibling
    // directory like `server/` gets that directory as its own layer just
    // the same, so a rules file missing it would deny-all on a crossing
    // nobody meant to forbid.
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-'));
    mkdirs('src/app', 'server');
    expect(discoverLayers(root)).toEqual(['app', 'server']);
  });

  it('skips a skippable directory even at the top level, beside src/', () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-'));
    mkdirs('src/app', 'node_modules/some-pkg');
    mkEmptyDirs('.github');
    expect(discoverLayers(root)).toEqual(['app']);
  });

  it('includes "(root)" for a loose file at the project root too, not just inside src/', () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-'));
    mkdirs('src/app');
    fs.writeFileSync(path.join(root, 'proxy.ts'), '');
    expect(discoverLayers(root)).toEqual(['(root)', 'app']);
  });

  it('skips a directory holding no source file, so it never names a layer no scan can produce', () => {
    // `layerOf` only ever names a directory a scanned file lives in, so a
    // `docs/` of markdown or a `public/` of images is not a layer. Listing
    // one would make `validateLayerRules` warn about `init-rules`' own output.
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-'));
    mkdirs('src/app');
    mkEmptyDirs('docs', 'public/img');
    fs.writeFileSync(path.join(root, 'docs/guide.md'), '');
    fs.writeFileSync(path.join(root, 'public/img/logo.svg'), '');
    expect(discoverLayers(root)).toEqual(['app']);
  });

  it('finds a source file nested any depth down when deciding a directory is a layer', () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-'));
    mkEmptyDirs('src/app/widgets/deep');
    fs.writeFileSync(path.join(root, 'src/app/widgets/deep/thing.tsx'), '');
    expect(discoverLayers(root)).toEqual(['app']);
  });

  it('ignores a non-parseable loose file at the root rather than calling it "(root)"', () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-'));
    mkdirs('src/app');
    fs.writeFileSync(path.join(root, 'README.md'), '');
    fs.writeFileSync(path.join(root, 'package.json'), '{}');
    expect(discoverLayers(root)).toEqual(['app']);
  });

  it('does not count a source file buried in a skipped directory as making its parent a layer', () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-'));
    mkdirs('src/app');
    mkEmptyDirs('vendored/node_modules/pkg');
    fs.writeFileSync(path.join(root, 'vendored/node_modules/pkg/index.js'), '');
    expect(discoverLayers(root)).toEqual(['app']);
  });

  it('follows a symlinked layer directory instead of dropping it and adding a phantom "(root)"', () => {
    // Module resolution follows the link like any other path, so the layer is
    // real. `Dirent.isDirectory()` alone says false and would both lose `ui`
    // and count the link as a loose file.
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-'));
    mkdirs('src/app', 'elsewhere/ui');
    fs.symlinkSync(path.join(root, 'elsewhere/ui'), path.join(root, 'src/ui'), 'dir');
    expect(discoverLayers(root)).toEqual(['app', 'elsewhere', 'ui']);
  });

  it('follows a symlinked src/ itself', () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-'));
    mkdirs('real-src/app', 'real-src/shared');
    fs.symlinkSync(path.join(root, 'real-src'), path.join(root, 'src'), 'dir');
    expect(discoverLayers(root)).toEqual(['app', 'real-src', 'shared']);
  });

  it('terminates on a symlink loop rather than recursing until the stack runs out', () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-'));
    mkEmptyDirs('src/app/nested');
    fs.symlinkSync(path.join(root, 'src/app'), path.join(root, 'src/app/nested/loop'), 'dir');
    expect(discoverLayers(root)).toEqual([]); // the loop holds no source file
  });

  it('treats a dangling symlink as the file it looks like, without throwing', () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-'));
    mkdirs('src/app');
    fs.symlinkSync(path.join(root, 'gone'), path.join(root, 'src/broken'), 'dir');
    expect(discoverLayers(root)).toEqual(['app']);
  });
});
