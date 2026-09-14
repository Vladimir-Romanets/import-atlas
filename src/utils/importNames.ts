/**
 * Merges the name lists of two import/export statements that the viewer
 * draws as one thing (two statements linking the same pair of files, or two
 * reaches into the same barrel).
 *
 * `'*'` is absorbing: it means "the graph can't say which names this
 * touches" (a namespace import, a dynamic `import()`, a `require()`, an
 * `export * from`), and unioning a known list into an unknown one cannot
 * make it known.
 */
export function unionNames(
  a: string[] | '*' | undefined,
  b: string[] | '*',
): string[] | '*' {
  if (a === '*' || b === '*') return '*';
  if (!a) return [...b];
  const set = new Set(a);
  for (const n of b) set.add(n);
  return [...set];
}
