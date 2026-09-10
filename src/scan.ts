import * as fs from 'fs';
import * as path from 'path';
import { loadTsConfig } from './configLoader';
import { extractImportSpecifiers } from './parseImports';
import { resolveSpecifier } from './resolveModule';
import type { Edge, FileNode, ScanResult } from './types';

export interface ScanOptions {
  /** Project root — relative paths in the report, and where to search for tsconfig.json. */
  root: string;
  tsconfigPath?: string;
  /** Regexes tested against each file's root-relative path; matches are not followed. */
  exclude?: RegExp[];
  /** Safety cap so a runaway scan (e.g. an entry deep in node_modules) can't hang. */
  maxFiles?: number;
}

function layerOf(relPath: string): string {
  const stripped = relPath.replace(/^src\//, '');
  const parts = stripped.split('/');
  return parts.length > 1 ? parts[0] : '(root)';
}

function labelOf(absPath: string): string {
  return path.basename(absPath).replace(/\.(tsx|ts|jsx|js|mjs|cjs)$/, '');
}

const PARSEABLE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']);

function isParseable(absPath: string): boolean {
  return PARSEABLE_EXTENSIONS.has(path.extname(absPath));
}

/**
 * Walks the local import graph breadth-first starting from `entryFiles`.
 * External packages (bare specifiers) are recorded on the importing node
 * but never followed. Returns the full graph — a file reachable from more
 * than one place keeps a single node with multiple inbound edges; turning
 * that into a displayable tree is `buildForest`'s job.
 */
export function scan(entryFiles: string[], options: ScanOptions): ScanResult {
  const root = path.resolve(options.root);
  const tsconfig = loadTsConfig(options.tsconfigPath, root);
  const maxFiles = options.maxFiles ?? 4000;
  const warnings: string[] = [];

  const nodes: Record<string, FileNode> = {};
  const edges: Edge[] = [];
  const seen = new Set<string>();
  const queue: string[] = [];

  function toId(absPath: string): string {
    return path.relative(root, absPath).split(path.sep).join('/');
  }

  function isExcluded(relPath: string): boolean {
    return (options.exclude || []).some((re) => re.test(relPath));
  }

  const entries: string[] = [];
  for (const entry of entryFiles) {
    const abs = path.resolve(root, entry);
    if (!fs.existsSync(abs)) {
      throw new Error(`Entry file not found: ${entry} (resolved to ${abs})`);
    }
    entries.push(toId(abs));
    if (!seen.has(abs)) {
      seen.add(abs);
      queue.push(abs);
    }
  }

  while (queue.length > 0) {
    if (Object.keys(nodes).length >= maxFiles) {
      warnings.push(
        `Stopped after ${maxFiles} files (--max-files). Pass a higher limit or narrower entry points.`
      );
      break;
    }

    const current = queue.shift()!;
    const id = toId(current);
    if (nodes[id]) continue;

    const externalImports: string[] = [];
    const unresolvedImports: string[] = [];
    let specifiers: string[] = [];
    if (isParseable(current)) {
      try {
        specifiers = extractImportSpecifiers(current);
      } catch (err) {
        warnings.push(`Could not parse ${id}: ${(err as Error).message}`);
      }
    }

    for (const spec of specifiers) {
      const { resolved, external } = resolveSpecifier(spec, current, tsconfig);

      if (external) {
        externalImports.push(spec);
        continue;
      }
      if (!resolved) {
        unresolvedImports.push(spec);
        continue;
      }

      const childId = toId(resolved);
      if (isExcluded(childId)) continue;

      edges.push({ from: id, to: childId });

      if (!seen.has(resolved)) {
        seen.add(resolved);
        queue.push(resolved);
      }
    }

    nodes[id] = {
      id,
      absPath: current,
      relPath: id,
      label: labelOf(current),
      layer: layerOf(id),
      externalImports,
      unresolvedImports
    };
  }

  // An edge is recorded as soon as its target resolves, before that target is
  // read — so breaking the walk on the cap leaves edges pointing at files that
  // never became nodes. Drop them: everything downstream looks an endpoint up
  // by id and expects a real node back.
  const walkedEdges = edges.filter((edge) => nodes[edge.to] !== undefined);

  const fanIn: Record<string, number> = {};
  for (const edge of walkedEdges) {
    fanIn[edge.to] = (fanIn[edge.to] || 0) + 1;
  }

  if (!tsconfig) {
    warnings.push('No tsconfig.json found — path aliases (e.g. "@/*") will not resolve.');
  }

  return { root, entries, nodes, edges: walkedEdges, fanIn, warnings };
}
