import * as fs from 'fs';
import * as path from 'path';
import type { ResolvedTsConfig } from './configLoader';

const EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];
const INDEX_FILES = EXTENSIONS.map((ext) => 'index' + ext);

function statSafe(p: string): fs.Stats | null {
  try {
    return fs.statSync(p);
  } catch {
    return null;
  }
}

// ESM TypeScript (`moduleResolution` node16/nodenext/bundler) writes the
// extension the file will have once compiled: `./util.js` for `util.ts`.
// TypeScript reads such a specifier as its source file first, and so do we.
const JS_TO_TS_EXTENSIONS: Record<string, string[]> = {
  '.js': ['.ts', '.tsx'],
  '.jsx': ['.tsx'],
  '.mjs': ['.mts'],
  '.cjs': ['.cts']
};

function tryResolveFile(candidate: string): string | null {
  const jsExt = path.extname(candidate);
  const tsExts = JS_TO_TS_EXTENSIONS[jsExt];
  if (tsExts) {
    const stem = candidate.slice(0, -jsExt.length);
    for (const ext of tsExts) {
      if (statSafe(stem + ext)?.isFile()) return stem + ext;
    }
  }

  const direct = statSafe(candidate);
  if (direct?.isFile()) return candidate;

  for (const ext of EXTENSIONS) {
    const withExt = candidate + ext;
    if (statSafe(withExt)?.isFile()) return withExt;
  }

  if (direct?.isDirectory()) {
    for (const idx of INDEX_FILES) {
      const p = path.join(candidate, idx);
      if (statSafe(p)?.isFile()) return p;
    }
  }

  return null;
}

export interface ResolveResult {
  resolved: string | null;
  external: boolean;
}

/**
 * Resolves a specifier found in `fromFile` to an absolute path: relative
 * ones against the importing file's directory, aliased ones against
 * tsconfig `paths`. Anything else is an external package, never followed.
 */
export function resolveSpecifier(
  specifier: string,
  fromFile: string,
  tsconfig: ResolvedTsConfig | null
): ResolveResult {
  if (specifier.startsWith('.')) {
    const abs = path.resolve(path.dirname(fromFile), specifier);
    return { resolved: tryResolveFile(abs), external: false };
  }

  if (tsconfig) {
    for (const [pattern, targets] of Object.entries(tsconfig.paths)) {
      const star = pattern.indexOf('*');

      if (star === -1) {
        if (pattern !== specifier) continue;
        for (const target of targets) {
          const abs = path.resolve(tsconfig.baseUrl, target);
          const resolved = tryResolveFile(abs);
          if (resolved) return { resolved, external: false };
        }
        continue;
      }

      const prefix = pattern.slice(0, star);
      const suffix = pattern.slice(star + 1);
      if (
        specifier.startsWith(prefix) &&
        specifier.endsWith(suffix) &&
        specifier.length >= prefix.length + suffix.length
      ) {
        const matched = specifier.slice(prefix.length, specifier.length - suffix.length);
        for (const target of targets) {
          const abs = path.resolve(tsconfig.baseUrl, target.replace('*', matched));
          const resolved = tryResolveFile(abs);
          if (resolved) return { resolved, external: false };
        }
      }
    }

    // No `paths` alias matched, but TypeScript still resolves non-relative
    // specifiers against an explicit `baseUrl`.
    if (tsconfig.baseUrlExplicit) {
      const abs = path.resolve(tsconfig.baseUrl, specifier);
      const resolved = tryResolveFile(abs);
      if (resolved) return { resolved, external: false };
    }
  }

  return { resolved: null, external: true };
}
