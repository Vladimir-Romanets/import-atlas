# Using it with file-system routers (Next.js, Nuxt, SvelteKit, Remix…)

import-atlas follows real `import` / `require` / `export ... from` statements and nothing else. It has no idea that a file is a page. Frameworks that route by file name load most of the app themselves: nothing ever imports `app/page.tsx` or `pages/about.tsx`, the router does. Point the tool at `app/layout.tsx` alone and you see what that one file imports — a couple of providers and `globals.css` — and nothing else.

The fix is to pass every route file as its own entry. Both commands accept many entries, and a file shared between them is still expanded only once, so a long entry list does not duplicate the app. Typing that list by hand does not scale, so generate it:

```bash
import-atlas tree $(find src/app -name "page.tsx" -o -name "layout.tsx") \
  --root . --open
```

Quote any path holding a `(route-group)` or `[param]` segment — parentheses and brackets mean something to the shell.

You get one tree per route file. Nothing joins a layout to the pages it wraps, because that nesting is the router's doing rather than an import. What crosses between the trees is the shared code: a component, a fetch helper, a store used by several routes is drawn once and opens wherever you click it.

For other frameworks, swap the `find` target: Next.js Pages Router (`find src/pages -name "*.tsx" ! -path "*/api/*"` — API routes are rarely worth graphing as UI dependencies), Nuxt (`pages/`), SvelteKit (`src/routes/`), Remix (`app/routes/`).
