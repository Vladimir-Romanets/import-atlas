#!/usr/bin/env node
import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { scan } from './scan';
import { buildForest } from './buildForest';
import { renderHtml } from './render';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const pkg = require('../package.json') as { version: string };

function openInBrowser(filePath: string): void {
  const platform = process.platform;
  const abs = path.resolve(filePath);
  if (platform === 'darwin') execFile('open', [abs]);
  else if (platform === 'win32') execFile('cmd', ['/c', 'start', '""', abs]);
  else execFile('xdg-open', [abs]);
}

function parseExclude(values: string[] | undefined): RegExp[] | undefined {
  if (!values || values.length === 0) return undefined;
  return values.map((v) => new RegExp(v));
}

const program = new Command();

program
  .name('import-atlas')
  .description("Scan a JS/TS project's local import graph and render it as an interactive dependency tree.")
  .version(pkg.version);

program
  .command('scan')
  .description('Scan entry file(s) and print the raw import graph as JSON')
  .argument('<entries...>', 'entry file(s), relative to --root')
  .option('-r, --root <dir>', 'project root (relative paths & tsconfig resolution)', process.cwd())
  .option('-c, --tsconfig <path>', 'explicit tsconfig.json path')
  .option('-e, --exclude <regex...>', 'skip files whose root-relative path matches this regex')
  .option('--max-files <n>', 'stop after scanning this many files', (v) => parseInt(v, 10), 4000)
  .option('-o, --out <file>', 'write JSON to this file instead of stdout')
  .action((entries: string[], opts) => {
    const result = scan(entries, {
      root: path.resolve(opts.root),
      tsconfigPath: opts.tsconfig,
      exclude: parseExclude(opts.exclude),
      maxFiles: opts.maxFiles
    });
    const json = JSON.stringify(result, null, 2);
    if (opts.out) {
      fs.writeFileSync(opts.out, json);
      console.error(`Wrote ${Object.keys(result.nodes).length} nodes, ${result.edges.length} edges to ${opts.out}`);
    } else {
      process.stdout.write(json + '\n');
    }
    for (const w of result.warnings) console.error(`⚠ ${w}`);
  });

program
  .command('graph', { isDefault: true })
  .description('Scan entry file(s) and render an interactive HTML dependency graph')
  .argument('<entries...>', 'entry file(s), relative to --root')
  .option('-r, --root <dir>', 'project root (relative paths & tsconfig resolution)', process.cwd())
  .option('-c, --tsconfig <path>', 'explicit tsconfig.json path')
  .option('-e, --exclude <regex...>', 'skip files whose root-relative path matches this regex')
  .option('--max-files <n>', 'stop after scanning this many files', (v) => parseInt(v, 10), 4000)
  .option('-o, --out <file>', 'output HTML file', 'import-graph.html')
  .option('-t, --title <title>', 'page title', 'Import Graph')
  .option('--json <file>', 'also write the raw graph JSON to this file')
  .option('--open', 'open the generated HTML in the default browser')
  .action((entries: string[], opts) => {
    const root = path.resolve(opts.root);
    const result = scan(entries, {
      root,
      tsconfigPath: opts.tsconfig,
      exclude: parseExclude(opts.exclude),
      maxFiles: opts.maxFiles
    });
    const forest = buildForest(result);
    const html = renderHtml(forest, result, { title: opts.title });

    fs.writeFileSync(opts.out, html);
    console.error(
      `Scanned ${Object.keys(result.nodes).length} files, ${result.edges.length} imports. Wrote ${opts.out}`
    );
    for (const w of result.warnings) console.error(`⚠ ${w}`);

    if (opts.json) {
      fs.writeFileSync(opts.json, JSON.stringify(result, null, 2));
      console.error(`Also wrote raw graph JSON to ${opts.json}`);
    }
    if (opts.open) openInBrowser(opts.out);
  });

program.parse();
