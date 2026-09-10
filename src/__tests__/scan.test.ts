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

describe('scan — a walk stopped by --max-files', () => {
  it('drops edges to files it never read, so every endpoint is a real node', () => {
    // The walk records an edge as soon as its target resolves, before reading
    // that target — so breaking on the cap left edges pointing at ids absent
    // from `nodes`, and rendering threw on the missing label.
    project(BARREL_PROJECT);
    const result = scan(['src/entry.ts'], { root, maxFiles: 2 });

    expect(Object.keys(result.nodes)).toHaveLength(2);
    for (const edge of result.edges) {
      expect(result.nodes[edge.from]).toBeDefined();
      expect(result.nodes[edge.to]).toBeDefined();
    }
    expect(() => buildForest(result)).not.toThrow();
  });

  it('still reads the whole graph when the cap is not reached', () => {
    project(BARREL_PROJECT);
    const result = scan(['src/entry.ts'], { root });

    expect(Object.keys(result.nodes)).toHaveLength(4);
    expect(result.warnings).toEqual([]);
  });
});
