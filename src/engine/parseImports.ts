import * as fs from 'fs';
import * as ts from 'typescript';
import type { ExportFacts } from '../types';

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
   * The target's own export name(s) — `propertyName` when aliased, so
   * `export { A as Alpha }` yields `A`. Used to compute what's ever been
   * requested of the target, whatever this statement calls it locally. '*'
   * for a namespace/dynamic import, `require()`, a bare side-effect import,
   * or `export * from`.
   */
  names: string[] | '*';
  /**
   * For a re-export, the outward name(s) this file exposes to its own
   * consumers — `name` when aliased, so `export { A as Alpha }` yields
   * `Alpha`. Equal to `names` without a rename, and never consulted for a
   * plain import, whose edge is never filtered.
   */
  exposedNames: string[] | '*';
  /** True for `export ... from '...'` (a re-export) as opposed to `import ... from '...'` (direct usage). Only re-export edges are candidates for barrel filtering — a plain import is proof of real usage. */
  isReexport: boolean;
  /**
   * True when the statement sits inside a function and so cannot run while
   * the importing module evaluates its top level (`React.lazy(() =>
   * import('./Page'))`). The dependency is real and stays in the graph; the
   * load-order coupling is what's absent, hence the cycle and duplicate
   * detectors skip these. A top-level `require()` or `await import()` is NOT
   * deferred — it runs during evaluation, with the same hazards.
   */
  isDeferred: boolean;
}

/**
 * `source` is what the imported module exports it as (`'default'`, or
 * `propertyName` falling back to `name`) — what's been requested of that
 * module. `local` is what this file binds it to: `import LoginPage from
 * './x'` binds `default` as `LoginPage`. Equal without a rename. The viewer
 * labels nodes with `local`, the name a reader of THIS file recognizes.
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
 * `source` is what the re-exported module exports it as (`propertyName`,
 * falling back to `name`) — what's requested of it. `exposed` is what this
 * file's re-export makes available to ITS consumers (`name`). They differ
 * under `export { A as Alpha }`.
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
 * The names a file exports through its own declarations — see
 * `ExportFacts`. Only top-level statements are examined, the only place an
 * export can legally appear.
 */
function collectExports(sourceFile: ts.SourceFile): ExportFacts {
  const ownNames: string[] = [];
  // Top-level `const X = { ... }` literals, kept in case the default export
  // forwards one (`const Utils = {...}; export default Utils`).
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
    // bindings under their outward names. With one it is a re-export — an
    // edge, left to `collectImports`.
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

  /**
   * `inFunction` separates lazy from eager — not the syntax used, but
   * whether the call can run while this module is still evaluating. Under a
   * function body it runs on call; at module scope it runs on load, like a
   * plain `import`. (An unawaited module-scope `import()` is counted eager
   * without being so, erring toward reporting a cycle rather than hiding it.)
   */
  function visit(node: ts.Node, inFunction: boolean): void {
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
        isReexport: false,
        isDeferred: false
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
        isReexport: true,
        isDeferred: false
      });
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      specifiers.push({ moduleSpecifier: (node.arguments[0] as ts.StringLiteral).text, names: '*', exposedNames: '*', isReexport: false, isDeferred: inFunction });
    } else if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'require' &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      specifiers.push({ moduleSpecifier: (node.arguments[0] as ts.StringLiteral).text, names: '*', exposedNames: '*', isReexport: false, isDeferred: inFunction });
    }
    const childrenInFunction = inFunction || ts.isFunctionLike(node);
    ts.forEachChild(node, (child) => visit(child, childrenInFunction));
  }

  visit(sourceFile, false);
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
 * Every static `import`/`export ... from`, dynamic `import('...')` and
 * `require('...')` specifier in a file, read off the TypeScript AST (not
 * regex) so it survives comments, strings and template literals that merely
 * look like imports. Records each statement's named bindings too, so barrel
 * expansion can tell which re-exports were actually requested.
 */
export function extractImportSpecifiers(filePath: string): ImportSpecifierInfo[] {
  return collectImports(parseFile(filePath));
}
