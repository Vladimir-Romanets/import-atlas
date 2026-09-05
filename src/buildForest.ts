import type { ScanResult, TreeNode } from './types';

function summarizeExternals(externalImports: string[]): string {
  if (externalImports.length === 0) return '';
  const shown = externalImports.slice(0, 6).join(', ');
  return externalImports.length > 6 ? `${shown}, +${externalImports.length - 6} more` : shown;
}

/**
 * Turns the full (possibly cyclic, multi-parent) import graph into one tree
 * per entry point. The first time a file is reached it is expanded in full;
 * every later occurrence becomes a compact reference (`ref` set to the
 * renderId of that first occurrence) instead of re-expanding its subtree —
 * otherwise a handful of widely-imported files would blow the tree up
 * combinatorially. A back-edge to a file still on the current path is
 * flagged as a circular import instead.
 */
export function buildForest(scanResult: ScanResult): TreeNode[] {
  const childrenOf: Record<string, string[]> = {};
  for (const edge of scanResult.edges) {
    (childrenOf[edge.from] ||= []).push(edge.to);
  }

  const canonicalRenderId: Record<string, string> = {};
  const onStack = new Set<string>();
  let uid = 0;
  const nextRenderId = () => `r${uid++}`;

  function makeNode(fileId: string, renderId: string, ref: string | null, warn: string): TreeNode {
    const file = scanResult.nodes[fileId];
    return {
      renderId,
      fileId,
      label: file.label,
      relPath: file.relPath,
      layer: file.layer,
      note: summarizeExternals(file.externalImports),
      warn,
      ref,
      fanIn: scanResult.fanIn[fileId] || 0,
      children: []
    };
  }

  function visit(fileId: string): TreeNode {
    const renderId = nextRenderId();
    canonicalRenderId[fileId] = renderId;
    onStack.add(fileId);

    const node = makeNode(fileId, renderId, null, '');
    for (const childId of childrenOf[fileId] || []) {
      const existingRenderId = canonicalRenderId[childId];
      if (existingRenderId !== undefined) {
        const warn = onStack.has(childId) ? 'circular import' : '';
        node.children.push(makeNode(childId, nextRenderId(), existingRenderId, warn));
        continue;
      }
      node.children.push(visit(childId));
    }

    onStack.delete(fileId);
    return node;
  }

  return scanResult.entries.map((id) => visit(id));
}
