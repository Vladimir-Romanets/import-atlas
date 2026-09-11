/**
 * The separator joining two file ids into one map key. A file id is a path
 * relative to the scan root, and no OS lets a path hold a NUL — so two
 * different (from, to) pairs can never collide into one key. Spelled as a
 * call rather than a string literal to keep a control character out of the
 * source, where no editor would render it.
 */
const PAIR_SEP = String.fromCharCode(0);

/**
 * Keys a (from, to) edge pair for lookup. Never decode this back into its
 * two ids — keep whatever you need in the map's value instead. Ids are real
 * paths, and a separator picked for being absent from paths today is one an
 * id format change could start putting in them.
 */
export function edgeKey(from: string, to: string): string {
  return `${from}${PAIR_SEP}${to}`;
}
