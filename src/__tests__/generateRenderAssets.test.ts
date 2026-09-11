import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The build inlines the viewer's CSS, HTML and help fragments into
 * `src/render.generated.ts` / `helpContent.generated.ts` by wrapping each
 * source in backticks, so anything a template literal treats as syntax has to
 * be escaped on the way in. Get it wrong and the generated file either fails
 * to parse (loud) or silently loses characters (not loud at all) — an author
 * writing `${'{'}...}` into a code sample in a help fragment would find out
 * only by reading the rendered output.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const require_ = createRequire(import.meta.url);
const { toTemplateLiteral } = require_(
  path.join(here, '..', '..', 'scripts', 'generate-render-assets.js'),
) as { toTemplateLiteral: (source: string) => string };

/**
 * Puts the escaped text back through the same evaluation the generated file
 * gets, which is the contract that actually matters: whatever went in has to
 * come back out byte for byte.
 */
function roundTrip(source: string): string {
  return new Function(`return \`${toTemplateLiteral(source)}\`;`)() as string;
}

describe('toTemplateLiteral', () => {
  it('escapes a backtick so it cannot close the literal early', () => {
    expect(toTemplateLiteral('run `npm test`')).toBe('run \\`npm test\\`');
    expect(roundTrip('run `npm test`')).toBe('run `npm test`');
  });

  it('escapes `${` so it cannot open an interpolation', () => {
    expect(toTemplateLiteral('<code>${name}</code>')).toBe('<code>\\${name}</code>');
    expect(roundTrip('<code>${name}</code>')).toBe('<code>${name}</code>');
  });

  it('leaves a lone $ alone, which needs no escaping', () => {
    expect(toTemplateLiteral('costs $5 and $ alone')).toBe('costs $5 and $ alone');
    expect(roundTrip('costs $5 and $ alone')).toBe('costs $5 and $ alone');
  });

  it('escapes a backslash before it can consume the next character', () => {
    expect(roundTrip('a\\nb')).toBe('a\\nb');
    expect(roundTrip('/\\d+\\s/')).toBe('/\\d+\\s/');
  });

  it('escapes backslashes first, so an escaped backtick is not mangled twice', () => {
    // A literal backslash followed by a backtick. Escaping backticks first
    // would produce `\\` + `` \` `` — a backslash that escapes the backslash,
    // leaving the backtick live and ending the literal.
    expect(roundTrip('a\\`b')).toBe('a\\`b');
    expect(roundTrip('\\${x}')).toBe('\\${x}');
  });

  it('round-trips a fragment combining every construct at once', () => {
    const nasty = 'const re = /\\$\\{/; // `${x}` stays literal, $ and \\ too';
    expect(roundTrip(nasty)).toBe(nasty);
  });

  it('leaves text with nothing to escape untouched', () => {
    const plain = '<p>Nothing special here.</p>';
    expect(toTemplateLiteral(plain)).toBe(plain);
  });
});

describe('inlined viewer sources', () => {
  const sources = [
    path.join(here, '..', 'render', 'render.css'),
    path.join(here, '..', 'render', 'render.html'),
    ...fs
      .readdirSync(path.join(here, '..', 'render', 'client', 'help'))
      .filter((name) => name.endsWith('.html'))
      .map((name) => path.join(here, '..', 'render', 'client', 'help', name)),
  ];

  it.each(sources.map((file) => [path.basename(file), file]))(
    'survives being inlined into a template literal: %s',
    (_name, file) => {
      const source = fs.readFileSync(file, 'utf8');
      expect(roundTrip(source)).toBe(source);
    },
  );
});
