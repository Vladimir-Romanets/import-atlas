import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildForest } from '../buildForest';
import { scan } from '../scan';

let root: string;

/** Writes `files` (path -> source) into a throwaway project root. */
function project(files: Record<string, string>): void {
  for (const [rel, source] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, source);
  }
}

const BARREL_PROJECT = {
  'tsconfig.json': '{"compilerOptions":{}}',
  'src/entry.ts': "import { Button } from './components/button';\nexport const app = Button;\n",
  'src/components/button/index.ts':
    "export { Button } from './Button';\nexport { IconButton } from './IconButton';\n",
  'src/components/button/Button.ts': 'export const Button = 1;\n',
  'src/components/button/IconButton.ts': 'export const IconButton = 2;\n',
};

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'import-atlas-scan-'));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('scan — coverage gaps', () => {
  it('reports no gaps and lets unused flagging run when the whole graph is read', () => {
    project(BARREL_PROJECT);
    const result = scan(['src/entry.ts'], { root });

    expect(result.coverageGaps).toEqual([]);

    const flags: boolean[] = [];
    const walk = (n: any) => {
      flags.push(n.unused);
      n.children.forEach(walk);
    };
    buildForest(result).forEach(walk);
    // IconButton is re-exported by the barrel but nobody asks for that name.
    expect(flags.filter(Boolean)).toHaveLength(1);
  });

  it('reports a gap and suppresses unused flagging when --max-files truncates the walk', () => {
    project(BARREL_PROJECT);
    const result = scan(['src/entry.ts'], { root, maxFiles: 2 });

    expect(result.coverageGaps).toHaveLength(1);
    expect(result.coverageGaps[0]).toContain('--max-files');

    const flags: boolean[] = [];
    const walk = (n: any) => {
      flags.push(n.unused);
      n.children.forEach(walk);
    };
    buildForest(result).forEach(walk);
    expect(flags.filter(Boolean)).toHaveLength(0);
  });

  it('drops edges to files the truncated walk never read, so every endpoint is a real node (regression)', () => {
    // The walk records an edge as soon as its target resolves, before reading
    // that target — so breaking on the cap used to leave edges pointing at
    // ids absent from `nodes`, and buildForest threw on the missing label.
    project(BARREL_PROJECT);
    const result = scan(['src/entry.ts'], { root, maxFiles: 2 });

    for (const edge of result.edges) {
      expect(result.nodes[edge.from]).toBeDefined();
      expect(result.nodes[edge.to]).toBeDefined();
    }
    expect(() => buildForest(result)).not.toThrow();
  });

  it('does not count a file dropped by --exclude as a coverage gap', () => {
    project(BARREL_PROJECT);
    const result = scan(['src/entry.ts'], {
      root,
      exclude: [/IconButton/],
    });

    expect(result.coverageGaps).toEqual([]);
    expect(result.nodes['src/components/button/IconButton.ts']).toBeUndefined();
  });
});
