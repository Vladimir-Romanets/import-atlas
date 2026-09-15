/**
 * All the search box reads off a node. The tree keys these by `renderId`
 * (one per occurrence), the merged graph by file id — either way the key is
 * what `jumpTo` gets back, so neither viewer needs its own copy.
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
   * Goes to a match. `committed` is false while the reader is still typing,
   * true once they press Enter.
   *
   * Every keystroke is a query of its own, and half-typed ones match files
   * nobody asked for — type `index` and the third keystroke finds a barrel.
   * So a viewer may only *open* something to reach a match when
   * `committed`, or a walk across the keyboard leaves a trail of opened
   * files. Showing a match already on screen is fine either way.
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
    // before jumping, and the reader hasn't been taken anywhere yet.
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
