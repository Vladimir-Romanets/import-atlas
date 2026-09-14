/**
 * The "imports: react, lodash, +3 more" line both viewers put on a node.
 *
 * Package imports are never followed by the scan, so they have no node of
 * their own to draw — this one-line summary on the importing file is the
 * only place they show up at all.
 */
export function summarizeExternals(externalImports: string[]): string {
  if (externalImports.length === 0) return "";
  const shown = externalImports.slice(0, 6).join(", ");
  return externalImports.length > 6
    ? `${shown}, +${externalImports.length - 6} more`
    : shown;
}
