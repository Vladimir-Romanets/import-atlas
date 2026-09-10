import type { RenderNode } from './types';

export interface SearchOptions {
  byId: Record<string, RenderNode>;
  searchInput: HTMLInputElement;
  searchHint: HTMLElement;
  jumpTo: (id: string) => void;
}

export function createSearch({ byId, searchInput, searchHint, jumpTo }: SearchOptions): void {
  const allNodes = Object.keys(byId).map((k) => byId[k]);
  let matches: RenderNode[] = [];
  let matchIdx = -1;

  function computeMatches(): RenderNode[] {
    const q = searchInput.value.trim().toLowerCase();
    if (!q) return [];
    return allNodes.filter((n) =>
      n.label.toLowerCase().indexOf(q) !== -1 || n.relPath.toLowerCase().indexOf(q) !== -1
    );
  }

  searchInput.addEventListener('input', () => {
    if (!searchInput.value.trim()){
      matches = [];
      matchIdx = -1;
      searchHint.textContent = '';
      return;
    }
    matches = computeMatches();
    matchIdx = matches.length ? 0 : -1;
    searchHint.textContent = matches.length ? `${matches.length} match${matches.length>1?'es':''} — press Enter to jump` : 'No matches';
    if (matches.length) jumpTo(matches[0].renderId);
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
    jumpTo(matches[matchIdx].renderId);
    searchHint.textContent = `Match ${matchIdx+1} of ${matches.length} — press Enter for next`;
  });
}
