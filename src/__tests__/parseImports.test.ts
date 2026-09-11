import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { extractImportSpecifiers, extractModuleFacts } from '../parseImports';

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
      { moduleSpecifier: './select', names: ['Select'], exposedNames: ['Select'], isReexport: false, isDeferred: false },
    ]);
  });

  it('keeps the source name in `names` (for matching) but the local alias in `exposedNames` (for display)', () => {
    // `names` tracks what's actually requested of select.ts ('Select', the
    // export's own name) regardless of local aliasing; `exposedNames` is
    // what THIS file calls it — 'MySelect' — since that's what a reader of
    // this file (and the viewer's node label) would recognize it as.
    const file = write(`import { Select as MySelect } from './select';`);
    expect(extractImportSpecifiers(file)).toEqual([
      { moduleSpecifier: './select', names: ['Select'], exposedNames: ['MySelect'], isReexport: false, isDeferred: false },
    ]);
  });

  it('uses the "default" sentinel for matching but the local binding name for display', () => {
    // `names: ['default']` is the placeholder used to match this edge
    // against how select.ts exports it internally; `exposedNames` is the
    // local name this statement actually binds it to ('Select') — the
    // viewer labels the node 'Select', not the internal 'default' sentinel.
    const file = write(`import Select from './select';`);
    expect(extractImportSpecifiers(file)).toEqual([
      { moduleSpecifier: './select', names: ['default'], exposedNames: ['Select'], isReexport: false, isDeferred: false },
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
      { moduleSpecifier: './LoginPage', names: ['default'], exposedNames: ['AAA'], isReexport: false, isDeferred: false },
    ]);
  });

  it('marks namespace imports as wildcard', () => {
    const file = write(`import * as Select from './select';`);
    expect(extractImportSpecifiers(file)).toEqual([
      { moduleSpecifier: './select', names: '*', exposedNames: '*', isReexport: false, isDeferred: false },
    ]);
  });

  it('marks a bare side-effect import as wildcard', () => {
    const file = write(`import './select';`);
    expect(extractImportSpecifiers(file)).toEqual([
      { moduleSpecifier: './select', names: '*', exposedNames: '*', isReexport: false, isDeferred: false },
    ]);
  });

  it('extracts named re-exports and marks them as re-exports', () => {
    const file = write(`export { Select } from './select';`);
    expect(extractImportSpecifiers(file)).toEqual([
      { moduleSpecifier: './select', names: ['Select'], exposedNames: ['Select'], isReexport: true, isDeferred: false },
    ]);
  });

  it('splits an aliased re-export into the source name (names) and the outward name (exposedNames)', () => {
    // `export { A as Alpha } from './a'` pulls A from a.ts (that's what's
    // "requested" of a.ts) but exposes it onward as Alpha to whoever imports
    // from *this* file — the two must not be conflated.
    const file = write(`export { A as Alpha } from './a';`);
    expect(extractImportSpecifiers(file)).toEqual([
      { moduleSpecifier: './a', names: ['A'], exposedNames: ['Alpha'], isReexport: true, isDeferred: false },
    ]);
  });

  it('marks `export * from` as wildcard on both names and exposedNames', () => {
    const file = write(`export * from './select';`);
    expect(extractImportSpecifiers(file)).toEqual([
      { moduleSpecifier: './select', names: '*', exposedNames: '*', isReexport: true, isDeferred: false },
    ]);
  });

  it('marks `export * as NS from` as wildcard on both names and exposedNames', () => {
    const file = write(`export * as Select from './select';`);
    expect(extractImportSpecifiers(file)).toEqual([
      { moduleSpecifier: './select', names: '*', exposedNames: '*', isReexport: true, isDeferred: false },
    ]);
  });

  it('marks dynamic import() as wildcard and not a re-export', () => {
    const file = write(`const mod = import('./select');`);
    expect(extractImportSpecifiers(file)).toEqual([
      { moduleSpecifier: './select', names: '*', exposedNames: '*', isReexport: false, isDeferred: false },
    ]);
  });

  it('marks require() as wildcard and not a re-export', () => {
    const file = write(`const mod = require('./select');`);
    expect(extractImportSpecifiers(file)).toEqual([
      { moduleSpecifier: './select', names: '*', exposedNames: '*', isReexport: false, isDeferred: false },
    ]);
  });

  // What makes an import deferred is not the syntax but the position: inside
  // a function it runs on call, at module scope it runs on load. Both the
  // cycle and the duplicate rule read `isDeferred`, not the call kind.
  describe('isDeferred', () => {
    const deferredFlags = (source: string): boolean[] =>
      extractImportSpecifiers(write(source)).map((spec) => spec.isDeferred);

    it('marks import() inside an arrow function as deferred', () => {
      expect(deferredFlags(`const Page = lazy(() => import('./Page'));`)).toEqual([true]);
    });

    it('marks import() inside an async function body as deferred', () => {
      expect(deferredFlags(`async function load() { return await import('./Page'); }`)).toEqual([true]);
    });

    it('marks require() inside a branch of a function as deferred', () => {
      expect(deferredFlags(`function f(flag) { if (flag) { return require('./slow'); } }`)).toEqual([true]);
    });

    it('marks require() inside a class method as deferred', () => {
      expect(deferredFlags(`class C { load() { return require('./slow'); } }`)).toEqual([true]);
    });

    it('does NOT mark a top-level require() as deferred — it runs on load', () => {
      expect(deferredFlags(`const mod = require('./select');`)).toEqual([false]);
    });

    it('does NOT mark a top-level awaited import() as deferred — it blocks evaluation', () => {
      expect(deferredFlags(`const mod = await import('./select');`)).toEqual([false]);
    });

    it('never marks a plain import or re-export declaration as deferred', () => {
      expect(
        deferredFlags(`import { A } from './a';\nexport { B } from './b';\nexport * from './c';`),
      ).toEqual([false, false, false]);
    });

    it('keeps the flag per statement when one file has both kinds', () => {
      const source = [
        `import type { Props } from './Page';`,
        `const Page = lazy(() => import('./Page'));`,
      ].join('\n');
      expect(deferredFlags(source)).toEqual([false, true]);
    });

    it('marks an import() nested two functions deep as deferred', () => {
      expect(
        deferredFlags(`function outer() { return () => import('./deep'); }`),
      ).toEqual([true]);
    });
  });
});

/** Sorted so a test doesn't depend on declaration order. */
const exportedNames = (file: string): string[] =>
  [...extractModuleFacts(file).exports.ownNames].sort();

describe('extractModuleFacts — exported names', () => {
  it('collects every declaration form that carries an export modifier', () => {
    const file = write(`
      export const a = 1, b = 2;
      export function fn() {}
      export class Cls {}
      export interface Iface {}
      export type Alias = string;
      export enum Enum { A }
    `);
    expect(exportedNames(file)).toEqual(['Alias', 'Cls', 'Enum', 'Iface', 'a', 'b', 'fn']);
  });

  it('ignores declarations that are not exported', () => {
    const file = write(`const hidden = 1;\nfunction alsoHidden() {}\nexport const shown = 2;`);
    expect(exportedNames(file)).toEqual(['shown']);
  });

  it('collects names out of a destructuring export', () => {
    const file = write(`export const { a, b: renamed } = source; export const [first] = list;`);
    expect(exportedNames(file)).toEqual(['a', 'first', 'renamed']);
  });

  it('collects the outward names of a local `export { ... }` statement', () => {
    const file = write(`const A = 1, B = 2;\nexport { A, B as C };`);
    expect(exportedNames(file)).toEqual(['A', 'C']);
  });

  it('leaves `export ... from` alone — a re-export is an edge, not an own export', () => {
    const file = write(`export { Select } from './select';\nexport * from './other';`);
    expect(exportedNames(file)).toEqual([]);
  });

  it('treats `export default function Foo(){}` as exporting only the default', () => {
    // `Foo` is a local binding here, not a second named export — importing
    // `{ Foo }` from this file would fail.
    const file = write(`export default function Foo() {}`);
    const { exports } = extractModuleFacts(file);
    expect(exports.ownNames).toEqual(['default']);
    expect(exports.defaultLocalName).toBe('Foo');
  });

  it('records the local name a plain `export default X` forwards', () => {
    const file = write(`export const LoginPage = 1;\nexport default LoginPage;`);
    const { exports } = extractModuleFacts(file);
    expect(exports.ownNames.sort()).toEqual(['LoginPage', 'default']);
    expect(exports.defaultLocalName).toBe('LoginPage');
    expect(exports.defaultAggregateNames).toEqual([]);
  });

  it('records the properties of an object the default export aggregates', () => {
    // Consumers reach these as `StringUtils.leftPad` — property access no
    // import graph can see, so findings must know the names are in there.
    const file = write(`
      export function leftPad() {}
      export function isBlank() {}
      const StringUtils = { leftPad, isBlank, extra: leftPad };
      export default StringUtils;
    `);
    const { exports } = extractModuleFacts(file);
    expect(exports.defaultAggregateNames).toEqual(['leftPad', 'isBlank', 'extra']);
    expect(exports.defaultLocalName).toBe('StringUtils');
  });

  it('records the properties of an object literal exported inline as default', () => {
    const file = write(`function a() {}\nfunction b() {}\nexport default { a, b };`);
    expect(extractModuleFacts(file).exports.defaultAggregateNames).toEqual(['a', 'b']);
  });

  it('flags `export =`, which replaces the module shape entirely', () => {
    const file = write(`const api = {};\nexport = api;`);
    const { exports } = extractModuleFacts(file);
    expect(exports.hasExportEquals).toBe(true);
    expect(exports.ownNames).toEqual([]);
  });

  it('returns both halves of the module boundary from one call', () => {
    const file = write(`import { Select } from './select';\nexport const wrapped = Select;`);
    const facts = extractModuleFacts(file);
    expect(facts.imports).toHaveLength(1);
    expect(facts.exports.ownNames).toEqual(['wrapped']);
  });
});
