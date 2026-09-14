import { describe, expect, it } from 'vitest';
import { createSearch, type Searchable } from '../render/client/search';

/**
 * The search box needs nothing from a real DOM but `value` and a pair of
 * listeners, so the tests hand it these instead of pulling in jsdom.
 */
function setUpSearch(byId: Record<string, Searchable>) {
  const handlers: Record<string, (event: unknown) => void> = {};
  const searchInput = {
    value: '',
    addEventListener(type: string, handler: (event: unknown) => void): void {
      handlers[type] = handler;
    },
  };
  const searchHint = { textContent: '' };
  const jumps: { id: string; committed: boolean }[] = [];

  createSearch({
    byId,
    searchInput: searchInput as unknown as HTMLInputElement,
    searchHint: searchHint as unknown as HTMLElement,
    jumpTo: (id, committed) => {
      jumps.push({ id, committed });
    },
  });

  return {
    jumps,
    hint: (): string => searchHint.textContent,
    type(text: string): void {
      searchInput.value = text;
      handlers.input({});
    },
    enter(): void {
      handlers.keydown({ key: 'Enter' });
    },
  };
}

/**
 * A project with two barrels in it, so that the half-typed `ind` matches
 * something the reader never asked for — which is the whole reason typing
 * and pressing Enter have to mean different things.
 */
const project: Record<string, Searchable> = {
  'src/main.ts': { label: 'main', relPath: 'src/main.ts' },
  'src/shared/pack0/index.ts': { label: 'index', relPath: 'src/shared/pack0/index.ts' },
  'src/shared/pack1/index.ts': { label: 'index', relPath: 'src/shared/pack1/index.ts' },
  'src/features/user.ts': { label: 'user', relPath: 'src/features/user.ts' },
};

describe('the search box', () => {
  it('never commits a jump while the query is still being typed', () => {
    // Every prefix of `index` is a query of its own, and two of them find a
    // barrel. A viewer that opened what it takes to reach each of them
    // would leave the canvas full of files nobody searched for.
    const search = setUpSearch(project);
    for (const n of [1, 2, 3, 4, 5]) search.type('index'.slice(0, n));

    expect(search.jumps.length).toBeGreaterThan(0);
    expect(search.jumps.every((j) => j.committed === false)).toBe(true);
  });

  it('commits the jump on Enter', () => {
    const search = setUpSearch(project);
    search.type('index');
    search.enter();

    expect(search.jumps.at(-1)).toEqual({
      id: 'src/shared/pack0/index.ts',
      committed: true,
    });
  });

  it('lands the first Enter on the first match, not the second', () => {
    // The cycle steps forward before it jumps, so typing has to leave the
    // cursor *before* the first match rather than on it.
    const search = setUpSearch(project);
    search.type('index');
    search.enter();
    search.enter();

    expect(search.jumps.filter((j) => j.committed).map((j) => j.id)).toEqual([
      'src/shared/pack0/index.ts',
      'src/shared/pack1/index.ts',
    ]);
  });

  it('starts the cycle over when the query changes', () => {
    const search = setUpSearch(project);
    search.type('index');
    search.enter();
    search.enter();
    search.type('index');
    search.enter();

    expect(search.jumps.at(-1)?.id).toBe('src/shared/pack0/index.ts');
  });

  it('says how many files matched, and nothing at all once the box is cleared', () => {
    const search = setUpSearch(project);
    search.type('index');
    expect(search.hint()).toBe('2 matches — press Enter to jump');

    search.type('nothing-matches-this');
    expect(search.hint()).toBe('No matches');

    const before = search.jumps.length;
    search.type('');
    expect(search.hint()).toBe('');
    expect(search.jumps.length).toBe(before);
  });

  it('does not jump on Enter when nothing matches', () => {
    const search = setUpSearch(project);
    search.type('nothing-matches-this');
    search.enter();

    expect(search.jumps).toEqual([]);
  });
});
