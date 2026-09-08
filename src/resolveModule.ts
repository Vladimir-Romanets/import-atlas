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

function tryResolveFile(candidate: string): string | null {
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
 * Resolves an import specifier found in `fromFile` to an absolute file path.
 * Relative specifiers are resolved against the importing file's directory;
 * aliased specifiers are matched against tsconfig `paths`; anything else is
 * treated as an external (node_modules) package and never recursed into.
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

    // No `paths` alias matched (or none configured) — TypeScript still resolves
    // non-relative specifiers directly against an explicit `baseUrl`.
    if (tsconfig.baseUrlExplicit) {
      const abs = path.resolve(tsconfig.baseUrl, specifier);
      const resolved = tryResolveFile(abs);
      if (resolved) return { resolved, external: false };
    }
  }

  return { resolved: null, external: true };
}
