/**
 * Separator joining two file ids into one map key. Ids are paths relative to
 * the scan root, and no OS lets a path hold a NUL, so two different (from,
 * to) pairs can never collide. Spelled as a call to keep a control character
 * no editor would render out of the source.
 */
const PAIR_SEP = String.fromCharCode(0);

/**
 * Keys a (from, to) edge pair for lookup. Never decode one back into its two
 * ids — keep what you need in the map's value. A separator picked for being
 * absent from paths today is one an id format change could start using.
 */
export function edgeKey(from: string, to: string): string {
  return `${from}${PAIR_SEP}${to}`;
}
