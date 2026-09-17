# The interactive viewer

## Tree

Drag to pan, scroll or use the +/− buttons to zoom, click a node to open or close it. "Find a file" in the sidebar jumps to any file by name or path. **Expand / Collapse** switches between opening everything already loaded and the default view, where only the first level or so is open.

A file used in several places is expanded in one of them. Elsewhere it is drawn as a node with no children yet. Click it and it fills in one level, copied from that expansion; its children then behave the same way. So following `Button` down two different pages shows each page's own path, instead of sending you to one shared copy. This is also why "Expand" never pulls a shared file's whole subtree into every place it is used.

Barrels are the exception: a barrel gets its own expansion for each distinct set of names asked of it, since that is what decides its children.

A link taken only lazily — a dynamic `import()`, or a `require` inside a function — is drawn dotted, as in the graph view. A pair linked by both a lazy statement and a plain one is drawn solid: the file loads eagerly regardless.

## Graph

Written by `import-atlas graph`, as a separate report. Every file is one node, however many places import it, and every importer gets an edge to it. So the thing a tree has to repeat — the barrel that twelve features use, the helper half the app imports — is drawn once here, with the twelve lines arriving at it. That convergence is the picture.

A node has a control on each side:

- the **chevron on the right** opens what the file imports, as in the tree;
- the **number on the left** is how many files import it, and clicking that opens them. It appears only where some of those importers aren't on screen yet: a file you opened from above is already showing the one that led you there, and so is a barrel whose importers are all drawn.

Clicking a node you have already clicked — one that is selected with nothing left to open — walks one step backwards, to the nearest file importing it; click again and again to follow a file's way back to the entry point. With several importers on screen the nearest one wins, since there is no other way to choose between them. A file the search landed on is not walked away from: it is selected on arrival, but the click that follows is still about the file itself.

The badge is what a tree cannot do from the node itself: it walks the graph backwards. Searching for a file does it for you — land on `shared/api` and its importers are already drawn, since "who uses this" is usually why you went looking.

Selecting a node dims everything it doesn't touch and lights up both directions at once: what imports it, what it imports, and — one hop further — which of a barrel's re-exports that selection actually reaches. That last part is how this view keeps what the tree gets structurally. The tree can give a barrel a separate expansion per set of names asked of it; a graph node serves every importer at once, so the same information is carried by emphasis instead. The barrel keeps all twenty children on screen, and selecting an importer lights the two it uses.

Cycle-closing edges are drawn dashed and red, right to left; lazy or dynamic imports are dotted. Columns are the distance from whatever is furthest upstream **among the nodes currently on screen**, so opening and closing things does move nodes sideways — the alternative is measuring against the whole project, which parks a widely-shared barrel hundreds of columns to the right of the entry point that also imports it directly.

Only what fits on screen is drawn, so a few thousand files stay responsive; zoomed far out, nodes become plain blocks of their layer's colour, since an 11px label is unreadable there anyway.

## Findings

Everything the graph can hold against the code, filterable by name or path. Rows are grouped by what to do about them, so the advice is written once on the group instead of on every row, and each group has a `?` icon that opens a fuller explanation of the rule. Four rules feed the list. Groups are ordered by how sure the graph can be: what it states as fact first, then the two groups that need a second opinion.

**Unused exports** — names nothing in the scan ever imports. Four groups:

- **Unimported exports** — no file in the scan imports the name. Drop the `export` keyword if the symbol is only used inside its own file, or delete the symbol.
- **Unimported re-exports** — a file forwards the name with `export ... from`, but nothing imports it from there. Barrels are where these collect, though any re-exporting file is checked the same way.
- **Named exports duplicating an imported default** — the file exports a symbol both by name and as its default, and only the default is ever imported. The named export is redundant.
- **Names reached through a default object** — the file collects local names into an object and default-exports it (`const Utils = { leftPad }; export default Utils`), and that default is imported. Callers most likely reach the name as `Utils.leftPad`, a property access no import graph can follow. Check these before removing anything.

**Circular imports** — one row per loop, found over the whole graph rather than per entry file, so it catches loops that no entry's walk order happens to reveal. A row shows the chain of imports that closes back on itself, and counts the files on that chain — the count always matches the names beside it. Tightest loops come first, since a pair of files importing each other is the easiest kind to separate.

Files often tangle into a group where everyone reaches everyone, and such a group holds many loops. Each one gets its own row, so a fix has a row to belong to; the hover text says how big the group is and how many loops were found in it. Only loops of four files or fewer are listed — longer ones are usually two shorter loops chained together. Raise that with `--max-cycle-length`, or drop it to `2` to see only mutual imports.

Only imports that run while a module is loading count. An import written inside a function — `lazy(() => import('./Page'))`, a `require()` in a branch — runs when that function is called, long after every module has loaded, so a loop closing only through one of those is not reported. A `require()` or `await import()` at the top level is counted: those run during loading, like a plain `import`.

**Duplicate imports** — one row per file-and-module pair linked by more than one statement: a value import plus a separate type-only import, two re-export lines, or the same path written twice. Imports inside functions are left out here too, since a lazy `import()` next to a static one is not a line you could merge without undoing the code splitting.

**Layer boundary violations** — only appears when a layer-rules file was checked: `import-atlas.rules.json` in `--root`, picked up on its own once it exists (generate one with `import-atlas init-rules`), or a different file named with `--rules`. One row per import that crosses from one layer into another the file isn't allowed to reach into, `high` confidence on every row since it's a check against a file the project's own team wrote, not a graph heuristic. Unlike the cycle and duplicate rules above, a deferred import (`lazy(() => import('./Page'))`) is still counted here — it crosses the same boundary a static import would, even though it carries no load-order coupling.

The unused-export rules skip a file completely when the graph cannot speak for it: an entry file (nothing inside the scan imports it, so its exports serve whatever lies outside), a file pulled in wholesale with `import * as X`, an `import()`, a `require()` or an `export * from`, a file using `export =`, and any file that would not parse. The cycle and duplicate rules read the import edges instead of the exports, so they need no such exemption — an entry file can and does show up in those two groups.

The list still runs when the scan reports coverage gaps — the `--max-files` cap fired, a file would not parse, a path would not resolve — and says so above the results, because a file the walk never read could be the one importing a name below. Two gaps cannot be detected at all: a consumer outside every entry file's reach, and one you dropped yourself with `--exclude`. Read "unimported" as "unimported within what was scanned", and widen your entry files before deleting in bulk.
