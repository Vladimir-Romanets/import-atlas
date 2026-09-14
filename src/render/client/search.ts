/**
 * All the search box reads off a node. The tree keys these by `renderId`
 * (one per occurrence) and the merged graph by file id (one per file) — in
 * both cases the key is what `jumpTo` is handed back, so neither viewer
 * needs its own copy of this.
 */
export interface Searchable {
  label: string;
  relPath: string;
}

export interface SearchOptions {
  byId: Record<string, Searchable>;
  searchInput: HTMLInputElement;
  searchHint: HTMLElement;
  /**
   * Goes to a match. `committed` separates the two ways this is reached:
   * false while the reader is still typing, true once they press Enter.
   *
   * Every keystroke is a query of its own, and the half-typed ones match
   * files nobody asked for — type `index` and the third keystroke finds a
   * barrel. A viewer that opens something to reach a match must do that
   * only when `committed`, or a walk across the keyboard leaves a trail of
   * opened files behind it. Showing a match that is already on screen is
   * fine either way.
   */
  jumpTo: (id: string, committed: boolean) => void;
}

export function createSearch({ byId, searchInput, searchHint, jumpTo }: SearchOptions): void {
  const allIds = Object.keys(byId);
  let matches: string[] = [];
  let matchIdx = -1;

  function computeMatches(): string[] {
    const q = searchInput.value.trim().toLowerCase();
    if (!q) return [];
    return allIds.filter((id) => {
      const n = byId[id];
      return n.label.toLowerCase().indexOf(q) !== -1 || n.relPath.toLowerCase().indexOf(q) !== -1;
    });
  }

  searchInput.addEventListener('input', () => {
    if (!searchInput.value.trim()){
      matches = [];
      matchIdx = -1;
      searchHint.textContent = '';
      return;
    }
    matches = computeMatches();
    // Left before the first match, not on it: the Enter below steps forward
    // before it jumps, and the reader has not been taken anywhere yet.
    matchIdx = -1;
    searchHint.textContent = matches.length ? `${matches.length} match${matches.length>1?'es':''} — press Enter to jump` : 'No matches';
    if (matches.length) jumpTo(matches[0], false);
  });

  searchInput.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    matches = computeMatches();
    if (!matches.length){
      matchIdx = -1;
      searchHint.textContent = searchInput.value.trim() ? 'No matches' : '';
      return;
    }
    matchIdx = (matchIdx+1) % matches.length;
    jumpTo(matches[matchIdx], true);
    searchHint.textContent = `Match ${matchIdx+1} of ${matches.length} — press Enter for next`;
  });
}
