import * as fs from 'fs';
import * as path from 'path';
import { isParseable, layersOf } from './scan';
import type { ScanResult } from '../types';

/**
 * How a layer may reach other layers: `'*'` for anywhere, an array for an
 * explicit allowlist, or `[]`/no entry to forbid all cross-layer imports.
 */
export type LayerRules = Record<string, '*' | string[]>;

/** Reads and validates a layer-rules JSON file, throwing on a bad shape instead of silently ignoring a typo. */
export function loadLayerRules(filePath: string): LayerRules {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    throw new Error(`Could not read layer-rules file ${filePath}: ${(err as Error).message}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`${filePath} is not valid JSON: ${(err as Error).message}`);
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(
      `${filePath} must be a JSON object mapping layer names to "*" or an array of layer names.`
    );
  }

  const rules: LayerRules = {};
  for (const [layer, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (value === '*') {
      rules[layer] = '*';
    } else if (Array.isArray(value) && value.every((v) => typeof v === 'string')) {
      rules[layer] = value;
    } else {
      throw new Error(
        `${filePath}: "${layer}" must be "*" or an array of layer names, got ${JSON.stringify(value)}.`
      );
    }
  }
  return rules;
}

const SKIPPABLE_DIR_PATTERN = /^__.+__$/; // __tests__, __mocks__, __snapshots__, __fixtures__, ...
const SKIPPABLE_DIR_NAMES = new Set(['node_modules', 'dist', 'build', 'out', 'coverage']);

function isSkippableDir(name: string): boolean {
  // Dot-prefixed also covers .git, .next, .turbo, .storybook, .vscode, ...
  return name.startsWith('.') || SKIPPABLE_DIR_PATTERN.test(name) || SKIPPABLE_DIR_NAMES.has(name);
}

/**
 * Whether this entry leads to a directory. `Dirent.isDirectory()` is false
 * for a symlink pointing at one — but module resolution follows that link
 * like any other path, so a symlinked layer (a monorepo checkout, a linked
 * shared package) is a real layer. Left unfollowed it would vanish from the
 * rules file and, worse, be counted as a loose file adding a phantom
 * `(root)`.
 */
function leadsToDir(dir: string, entry: fs.Dirent): boolean {
  if (entry.isDirectory()) return true;
  if (!entry.isSymbolicLink()) return false;
  try {
    return fs.statSync(path.join(dir, entry.name)).isDirectory();
  } catch {
    return false; // dangling link — treat it as the file it looks like
  }
}

/**
 * Whether `dir` holds a file the scanner could actually parse, at any depth
 * below the directories discovery already ignores. What makes a directory a
 * layer is that `layerOf` can name it — and it only ever names one holding a
 * scanned file. Without this, `docs/`, `public/` and friends land in the
 * starter file as layers, and `validateLayerRules` then warns about every one
 * of them as unknown: `init-rules` complaining about its own output.
 *
 * `seen` holds the real path of every directory already walked. Following
 * symlinks means a link pointing at one of its own ancestors would otherwise
 * recurse until the stack runs out.
 */
function holdsSource(dir: string, seen: Set<string>): boolean {
  let real: string;
  try {
    real = fs.realpathSync(dir);
  } catch {
    return false; // unresolvable — nothing in here can become a scanned file
  }
  if (seen.has(real)) return false;
  seen.add(real);

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return false; // unreadable — same
  }
  for (const entry of entries) {
    if (!leadsToDir(dir, entry)) {
      if (isParseable(entry.name)) return true;
    } else if (!isSkippableDir(entry.name) && holdsSource(path.join(dir, entry.name), seen)) {
      return true;
    }
  }
  return false;
}

function addLayer(dir: string, entry: fs.Dirent, layers: Set<string>): void {
  if (!leadsToDir(dir, entry)) {
    // A loose file here is `layerOf`'s '(root)' layer — but only a parseable
    // one: a README or a package.json never becomes a node to carry it.
    if (isParseable(entry.name)) layers.add('(root)');
  } else if (!isSkippableDir(entry.name) && holdsSource(path.join(dir, entry.name), new Set())) {
    layers.add(entry.name);
  }
}

/**
 * The starter set of layer names for `init-rules`. Reads the directory tree
 * instead of a scan, so it needs no entry files and won't miss a layer that
 * nothing happens to import (an unreachable page, its own middleware entry
 * point). Mirrors `layerOf`, which only strips a leading `src/` — so this
 * walks every top-level directory under `root`, not just `src/`, and only
 * recurses one level into `src/` itself, since a sibling source directory
 * (`server/`, say) is just as much its own layer.
 */
export function discoverLayers(root: string): string[] {
  const layers = new Set<string>();
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.name === 'src' && leadsToDir(root, entry)) {
      const srcDir = path.join(root, 'src');
      for (const child of fs.readdirSync(srcDir, { withFileTypes: true })) {
        addLayer(srcDir, child, layers);
      }
    } else {
      addLayer(root, entry, layers);
    }
  }
  return [...layers].sort();
}

/**
 * Catches a rules file drifting from the code: a key or allowlist entry
 * naming a layer that doesn't exist (typo, renamed/removed folder — an
 * allowlist typo silently denies the import instead of erroring), or a
 * real layer missing from the file (silently defaults to deny-all).
 * Separate from `ScanResult.warnings`/`coverageGaps`, which are about what
 * the scan could read, not whether the rules file still matches it.
 */
export function validateLayerRules(scanResult: ScanResult, rules: LayerRules): string[] {
  const realLayers = new Set(layersOf(scanResult));
  const warnings: string[] = [];

  for (const [layer, allowed] of Object.entries(rules)) {
    if (!realLayers.has(layer)) {
      warnings.push(`layer-rules file mentions unknown layer '${layer}' — no scanned file belongs to it.`);
    }
    if (Array.isArray(allowed)) {
      for (const target of allowed) {
        if (!realLayers.has(target)) {
          warnings.push(
            `layer-rules file allows '${layer}' to import from unknown layer '${target}' — no scanned file belongs to it.`
          );
        }
      }
    }
  }
  for (const layer of realLayers) {
    if (!(layer in rules)) {
      warnings.push(`layer '${layer}' has no rule in the layer-rules file — it defaults to importing from no other layer.`);
    }
  }
  return warnings;
}
