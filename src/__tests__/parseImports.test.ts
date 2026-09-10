import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { extractImportSpecifiers } from '../parseImports';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'import-atlas-parse-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function write(source: string): string {
  const file = path.join(dir, 'fixture.ts');
  fs.writeFileSync(file, source);
  return file;
}

describe('extractImportSpecifiers', () => {
  it('extracts named imports', () => {
    const file = write(`import { Select } from './select';`);
    expect(extractImportSpecifiers(file)).toEqual([
      { moduleSpecifier: './select', names: ['Select'], exposedNames: ['Select'], isReexport: false },
    ]);
  });

  it('keeps the source name in `names` (for matching) but the local alias in `exposedNames` (for display)', () => {
    // `names` tracks what's actually requested of select.ts ('Select', the
    // export's own name) regardless of local aliasing; `exposedNames` is
    // what THIS file calls it — 'MySelect' — since that's what a reader of
    // this file (and the viewer's node label) would recognize it as.
    const file = write(`import { Select as MySelect } from './select';`);
    expect(extractImportSpecifiers(file)).toEqual([
      { moduleSpecifier: './select', names: ['Select'], exposedNames: ['MySelect'], isReexport: false },
    ]);
  });

  it('uses the "default" sentinel for matching but the local binding name for display', () => {
    // `names: ['default']` is the placeholder used to match this edge
    // against how select.ts exports it internally; `exposedNames` is the
    // local name this statement actually binds it to ('Select') — the
    // viewer labels the node 'Select', not the internal 'default' sentinel.
    const file = write(`import Select from './select';`);
    expect(extractImportSpecifiers(file)).toEqual([
      { moduleSpecifier: './select', names: ['default'], exposedNames: ['Select'], isReexport: false },
    ]);
  });

  it('combines a default and named import on one line', () => {
    const file = write(`import Select, { useSelectContext } from './select';`);
    const [spec] = extractImportSpecifiers(file);
    expect(spec.names).toEqual(expect.arrayContaining(['default', 'useSelectContext']));
    expect(spec.exposedNames).toEqual(expect.arrayContaining(['Select', 'useSelectContext']));
    expect(spec.isReexport).toBe(false);
  });

  it('uses the local alias, not the source name, in `exposedNames` for an aliased default import', () => {
    // import AAA from './LoginPage' — the viewer should label the node
    // 'AAA' (what this file calls it), not 'default' (the internal
    // sentinel used only for matching against LoginPage.tsx's own export).
    const file = write(`import AAA from './LoginPage';`);
    expect(extractImportSpecifiers(file)).toEqual([
      { moduleSpecifier: './LoginPage', names: ['default'], exposedNames: ['AAA'], isReexport: false },
    ]);
  });

  it('marks namespace imports as wildcard', () => {
    const file = write(`import * as Select from './select';`);
    expect(extractImportSpecifiers(file)).toEqual([
      { moduleSpecifier: './select', names: '*', exposedNames: '*', isReexport: false },
    ]);
  });

  it('marks a bare side-effect import as wildcard', () => {
    const file = write(`import './select';`);
    expect(extractImportSpecifiers(file)).toEqual([
      { moduleSpecifier: './select', names: '*', exposedNames: '*', isReexport: false },
    ]);
  });

  it('extracts named re-exports and marks them as re-exports', () => {
    const file = write(`export { Select } from './select';`);
    expect(extractImportSpecifiers(file)).toEqual([
      { moduleSpecifier: './select', names: ['Select'], exposedNames: ['Select'], isReexport: true },
    ]);
  });

  it('splits an aliased re-export into the source name (names) and the outward name (exposedNames)', () => {
    // `export { A as Alpha } from './a'` pulls A from a.ts (that's what's
    // "requested" of a.ts) but exposes it onward as Alpha to whoever imports
    // from *this* file — the two must not be conflated.
    const file = write(`export { A as Alpha } from './a';`);
    expect(extractImportSpecifiers(file)).toEqual([
      { moduleSpecifier: './a', names: ['A'], exposedNames: ['Alpha'], isReexport: true },
    ]);
  });

  it('marks `export * from` as wildcard on both names and exposedNames', () => {
    const file = write(`export * from './select';`);
    expect(extractImportSpecifiers(file)).toEqual([
      { moduleSpecifier: './select', names: '*', exposedNames: '*', isReexport: true },
    ]);
  });

  it('marks `export * as NS from` as wildcard on both names and exposedNames', () => {
    const file = write(`export * as Select from './select';`);
    expect(extractImportSpecifiers(file)).toEqual([
      { moduleSpecifier: './select', names: '*', exposedNames: '*', isReexport: true },
    ]);
  });

  it('marks dynamic import() as wildcard and not a re-export', () => {
    const file = write(`const mod = import('./select');`);
    expect(extractImportSpecifiers(file)).toEqual([
      { moduleSpecifier: './select', names: '*', exposedNames: '*', isReexport: false },
    ]);
  });

  it('marks require() as wildcard and not a re-export', () => {
    const file = write(`const mod = require('./select');`);
    expect(extractImportSpecifiers(file)).toEqual([
      { moduleSpecifier: './select', names: '*', exposedNames: '*', isReexport: false },
    ]);
  });
});
