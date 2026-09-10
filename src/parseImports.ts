import * as fs from 'fs';
import * as ts from 'typescript';
import type { ExportFacts } from './types';

function scriptKindFor(filePath: string): ts.ScriptKind {
  if (filePath.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (filePath.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (filePath.endsWith('.ts') || filePath.endsWith('.mts') || filePath.endsWith('.cts')) {
    return ts.ScriptKind.TS;
  }
  return ts.ScriptKind.JS;
}

export interface ImportSpecifierInfo {
  moduleSpecifier: string;
  /**
   * Name(s) this statement pulls FROM the target module — the target's own
   * export name (`propertyName` when aliased, e.g. `export { A as Alpha }`
   * yields `A` here). Used to compute what's ever been requested of the
   * target file, regardless of what this statement itself calls it.
   * '*' when that can't be determined (namespace import, dynamic import(),
   * require(), a bare side-effect import, or `export * from`).
   */
  names: string[] | '*';
  /**
   * For a re-export, the name(s) THIS file exposes onward to its own
   * consumers via this statement (the local/outward name — `name` when
   * aliased, e.g. `export { A as Alpha }` yields `Alpha` here). Equal to
   * `names` when there's no rename. Meaningless for a plain import (mirrors
   * `names`, but is never consulted — a plain import edge is never filtered).
   */
  exposedNames: string[] | '*';
  /** True for `export ... from '...'` (a re-export, forwarding a name onward to this file's own consumers) as opposed to a plain `import ... from '...'` (direct, unconditional usage by this file). Only re-export edges are ever candidates for the "unused" barrel-filtering view — a plain import is proof of real usage regardless of what name the importing file is itself known by elsewhere. */
  isReexport: boolean;
}

/**
 * `source` is the name(s) as exported by the imported module itself
 * (`'default'` for a default import; `propertyName`, falling back to
 * `name`, for a named one) — used to compute what's ever been requested of
 * that module, regardless of what THIS file calls it locally. `local` is
 * the name this statement actually binds it to in this file's own scope
 * (`clause.name` / `spec.name`) — e.g. `import LoginPage from './x'` binds
 * `default` as `LoginPage`; `import { Foo as Bar } from './x'` binds `Foo`
 * as `Bar`. Equal to `source` when there's no local rename. Used to label
 * the node in the viewer as what a reader of THIS file would recognize it
 * by, not the target's own internal name for it.
 */
function namesFromImportClause(
  clause: ts.ImportClause | undefined,
): { source: string[] | '*'; local: string[] | '*' } {
  if (!clause) return { source: '*', local: '*' };
  const source: string[] = [];
  const local: string[] = [];
  if (clause.name) {
    source.push('default');
    local.push(clause.name.text);
  }
  const bindings = clause.namedBindings;
  if (bindings) {
    if (ts.isNamespaceImport(bindings)) return { source: '*', local: '*' };
    for (const spec of bindings.elements) {
      source.push((spec.propertyName ?? spec.name).text);
      local.push(spec.name.text);
    }
  }
  return source.length ? { source, local } : { source: '*', local: '*' };
}

/**
 * `source` is the name(s) as exported by the re-exported module itself
 * (`propertyName`, falling back to `name` when there's no `as` alias) —
 * this is what's being "requested" of that module. `exposed` is the
 * name(s) this file's own re-export statement makes available to ITS
 * consumers (`name`) — these can differ under `export { A as Alpha }`.
 */
function namesFromExportClause(
  node: ts.ExportDeclaration,
): { source: string[] | '*'; exposed: string[] | '*' } {
  const clause = node.exportClause;
  if (!clause) return { source: '*', exposed: '*' }; // `export * from '...'`
  if (ts.isNamespaceExport(clause)) return { source: '*', exposed: '*' }; // `export * as NS from '...'`
  const source: string[] = [];
  const exposed: string[] = [];
  for (const spec of clause.elements) {
    source.push((spec.propertyName ?? spec.name).text);
    exposed.push(spec.name.text);
  }
  return { source, exposed };
}

/** Flattens a binding name into the identifiers it introduces, so `export const { a, b } = x` counts as exporting both. */
function collectBindingNames(name: ts.BindingName, out: string[]): void {
  if (ts.isIdentifier(name)) {
    out.push(name.text);
    return;
  }
  for (const element of name.elements) {
    if (ts.isOmittedExpression(element)) continue;
    collectBindingNames(element.name, out);
  }
}

function objectLiteralPropertyNames(literal: ts.ObjectLiteralExpression): string[] {
  const names: string[] = [];
  for (const property of literal.properties) {
    if (property.name && ts.isIdentifier(property.name)) names.push(property.name.text);
  }
  return names;
}

/**
 * Collects the names a file exports through its own declarations — see
 * `ExportFacts`. Only top-level statements are examined, which is also the
 * only place an export can legally appear.
 */
function collectExports(sourceFile: ts.SourceFile): ExportFacts {
  const ownNames: string[] = [];
  // Top-level `const X = { ... }` literals, kept in case the default export
  // turns out to forward one of them (the `const Utils = {...}; export
  // default Utils` aggregation pattern).
  const objectLiterals: Record<string, string[]> = {};
  let defaultExpression: ts.Expression | null = null;
  let defaultLocalName: string | null = null;
  let hasExportEquals = false;

  for (const statement of sourceFile.statements) {
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (
          ts.isIdentifier(declaration.name) &&
          declaration.initializer &&
          ts.isObjectLiteralExpression(declaration.initializer)
        ) {
          objectLiterals[declaration.name.text] = objectLiteralPropertyNames(declaration.initializer);
        }
      }
    }

    if (ts.isExportAssignment(statement)) {
      if (statement.isExportEquals) {
        hasExportEquals = true;
        continue;
      }
      ownNames.push('default');
      defaultExpression = statement.expression;
      continue;
    }

    // `export { A, B as C };` with no module specifier exposes local
    // bindings under their outward names. (With a specifier it's a
    // re-export, i.e. an edge, and is left to `collectImports`.)
    if (ts.isExportDeclaration(statement) && !statement.moduleSpecifier) {
      const clause = statement.exportClause;
      if (clause && ts.isNamedExports(clause)) {
        for (const element of clause.elements) ownNames.push(element.name.text);
      }
      continue;
    }

    const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) : undefined;
    if (!modifiers || !modifiers.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) continue;

    if (modifiers.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)) {
      // `export default function Foo(){}` exposes `default` and nothing
      // else — `Foo` is a local binding, not a second named export.
      ownNames.push('default');
      if (
        (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) &&
        statement.name
      ) {
        defaultLocalName = statement.name.text;
      }
      continue;
    }

    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        collectBindingNames(declaration.name, ownNames);
      }
      continue;
    }

    // function / class / interface / type alias / enum / namespace.
    const named = statement as ts.Statement & { name?: ts.Node };
    if (named.name && ts.isIdentifier(named.name)) ownNames.push(named.name.text);
  }

  let defaultAggregateNames: string[] = [];
  if (defaultExpression) {
    if (ts.isIdentifier(defaultExpression)) {
      defaultLocalName = defaultExpression.text;
      defaultAggregateNames = objectLiterals[defaultExpression.text] ?? [];
    } else if (ts.isObjectLiteralExpression(defaultExpression)) {
      defaultAggregateNames = objectLiteralPropertyNames(defaultExpression);
    }
  }

  return {
    ownNames: [...new Set(ownNames)],
    defaultAggregateNames,
    defaultLocalName,
    hasExportEquals,
  };
}

function collectImports(sourceFile: ts.SourceFile): ImportSpecifierInfo[] {
  const specifiers: ImportSpecifierInfo[] = [];

  function visit(node: ts.Node): void {
    if (
      ts.isImportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const { source: importNames, local: importLocalNames } = namesFromImportClause(node.importClause);
      specifiers.push({
        moduleSpecifier: node.moduleSpecifier.text,
        names: importNames,
        exposedNames: importLocalNames,
        isReexport: false
      });
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const { source: sourceNames, exposed: exposedNames } = namesFromExportClause(node);
      specifiers.push({
        moduleSpecifier: node.moduleSpecifier.text,
        names: sourceNames,
        exposedNames,
        isReexport: true
      });
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      specifiers.push({ moduleSpecifier: (node.arguments[0] as ts.StringLiteral).text, names: '*', exposedNames: '*', isReexport: false });
    } else if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'require' &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      specifiers.push({ moduleSpecifier: (node.arguments[0] as ts.StringLiteral).text, names: '*', exposedNames: '*', isReexport: false });
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return specifiers;
}

function parseFile(filePath: string): ts.SourceFile {
  const source = fs.readFileSync(filePath, 'utf8');
  return ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKindFor(filePath)
  );
}

/** Everything one file says about its module boundary: what it asks of others, and what it offers them. */
export interface ModuleFacts {
  imports: ImportSpecifierInfo[];
  exports: ExportFacts;
}

/**
 * Reads a file's imports and exports in a single parse — the scan needs
 * both, and parsing each file twice over a large project is pure waste.
 */
export function extractModuleFacts(filePath: string): ModuleFacts {
  const sourceFile = parseFile(filePath);
  return { imports: collectImports(sourceFile), exports: collectExports(sourceFile) };
}

/**
 * Extracts every static `import ... from '...'`, `export ... from '...'`,
 * dynamic `import('...')` and `require('...')` module specifier from a file,
 * via the TypeScript AST (not regex) so it survives comments, strings, and
 * template literals that merely look like imports. Also records which named
 * bindings each statement references, so barrel-file expansion can tell
 * which re-exports were actually requested somewhere.
 */
export function extractImportSpecifiers(filePath: string): ImportSpecifierInfo[] {
  return collectImports(parseFile(filePath));
}
