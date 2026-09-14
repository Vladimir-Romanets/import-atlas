#!/usr/bin/env node
import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { scan } from './engine/scan';
import { buildForest } from './engine/buildForest';
import { buildGraph } from './engine/buildGraph';
import { renderHtml } from './report/render';
import { renderGraphHtml } from './report/renderGraph';
import { DEFAULT_MAX_CYCLE_LENGTH } from './engine/circularImports';

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
    console.error('Scanning...');
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
  .option(
    '--max-cycle-length <n>',
    'longest circular-import loop reported as its own row',
    (v) => parseInt(v, 10),
    DEFAULT_MAX_CYCLE_LENGTH
  )
  .option('-o, --out <file>', 'output HTML file', 'import-graph.html')
  .option('-t, --title <title>', 'page title', 'Import Graph')
  .option('--json <file>', 'also write the raw graph JSON to this file')
  .option('--open', 'open the generated HTML in the default browser')
  .action((entries: string[], opts) => {
    console.error('Scanning...');
    const root = path.resolve(opts.root);
    const result = scan(entries, {
      root,
      tsconfigPath: opts.tsconfig,
      exclude: parseExclude(opts.exclude),
      maxFiles: opts.maxFiles
    });
    const forest = buildForest(result);
    const html = renderHtml(forest, result, {
      title: opts.title,
      maxCycleLength: opts.maxCycleLength
    });

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

program
  .command('merged')
  .alias('dag')
  .description(
    'Scan entry file(s) and render one merged graph: every file drawn once, with an edge from each importer'
  )
  .argument('<entries...>', 'entry file(s), relative to --root')
  .option('-r, --root <dir>', 'project root (relative paths & tsconfig resolution)', process.cwd())
  .option('-c, --tsconfig <path>', 'explicit tsconfig.json path')
  .option('-e, --exclude <regex...>', 'skip files whose root-relative path matches this regex')
  // Higher than the tree's cap: the merged view draws a file once however
  // many places import it, so it stays legible at a size the tree would
  // have turned into thousands of repeated boxes.
  .option('--max-files <n>', 'stop after scanning this many files', (v) => parseInt(v, 10), 10000)
  .option(
    '--max-cycle-length <n>',
    'longest circular-import loop reported as its own row',
    (v) => parseInt(v, 10),
    DEFAULT_MAX_CYCLE_LENGTH
  )
  .option('-o, --out <file>', 'output HTML file', 'import-graph-merged.html')
  .option('-t, --title <title>', 'page title', 'Import Graph (merged)')
  .option('--json <file>', 'also write the raw graph JSON to this file')
  .option('--open', 'open the generated HTML in the default browser')
  .action((entries: string[], opts) => {
    console.error('Scanning...');
    const root = path.resolve(opts.root);
    const result = scan(entries, {
      root,
      tsconfigPath: opts.tsconfig,
      exclude: parseExclude(opts.exclude),
      maxFiles: opts.maxFiles
    });
    const graph = buildGraph(result);
    const html = renderGraphHtml(graph, result, {
      title: opts.title,
      maxCycleLength: opts.maxCycleLength
    });

    fs.writeFileSync(opts.out, html);
    const shared = graph.nodes.filter((node) => node.fanIn > 1).length;
    console.error(
      `Scanned ${graph.nodes.length} files, ${graph.edges.length} links (${shared} shared by more than one importer). Wrote ${opts.out}`
    );
    for (const w of result.warnings) console.error(`⚠ ${w}`);

    if (opts.json) {
      fs.writeFileSync(opts.json, JSON.stringify(result, null, 2));
      console.error(`Also wrote raw graph JSON to ${opts.json}`);
    }
    if (opts.open) openInBrowser(opts.out);
  });

program
  .command('all')
  .description(
    'Scan entry file(s) once and render every report: the tree and the merged graph'
  )
  .argument('<entries...>', 'entry file(s), relative to --root')
  .option('-r, --root <dir>', 'project root (relative paths & tsconfig resolution)', process.cwd())
  .option('-c, --tsconfig <path>', 'explicit tsconfig.json path')
  .option('-e, --exclude <regex...>', 'skip files whose root-relative path matches this regex')
  // The tree's cap rather than the merged viewer's: one scan feeds every
  // report, so the lowest cap among them is the one that has to hold. A tree
  // is what gives out first — it repeats a shared file once per place
  // reaching it.
  .option('--max-files <n>', 'stop after scanning this many files', (v) => parseInt(v, 10), 4000)
  .option(
    '--max-cycle-length <n>',
    'longest circular-import loop reported as its own row',
    (v) => parseInt(v, 10),
    DEFAULT_MAX_CYCLE_LENGTH
  )
  .option('--out-tree <file>', 'output HTML file for the tree', 'import-graph.html')
  .option('--out-merged <file>', 'output HTML file for the merged graph', 'import-graph-merged.html')
  .option('-t, --title <title>', 'page title; the merged report gets " (merged)" appended', 'Import Graph')
  .option('--json <file>', 'also write the raw graph JSON to this file')
  .option('--open', 'open every generated HTML file in the default browser')
  .action((entries: string[], opts) => {
    console.error('Scanning...');
    const root = path.resolve(opts.root);
    const result = scan(entries, {
      root,
      tsconfigPath: opts.tsconfig,
      exclude: parseExclude(opts.exclude),
      maxFiles: opts.maxFiles
    });

    // Merged first, deliberately. The tree is the report that can still fail
    // on a deeply chained project (see KNOWN_ISSUES.md), so writing the
    // sturdier one first leaves the reader with something to open when it
    // does — the rule to keep as reports are added is sturdiest first.
    const graph = buildGraph(result);
    fs.writeFileSync(
      opts.outMerged,
      renderGraphHtml(graph, result, {
        title: `${opts.title} (merged)`,
        maxCycleLength: opts.maxCycleLength
      })
    );

    const shared = graph.nodes.filter((node) => node.fanIn > 1).length;
    const summary = `Scanned ${graph.nodes.length} files, ${graph.edges.length} links (${shared} shared by more than one importer).`;

    try {
      const forest = buildForest(result);
      fs.writeFileSync(
        opts.outTree,
        renderHtml(forest, result, {
          title: opts.title,
          maxCycleLength: opts.maxCycleLength
        })
      );
    } catch (e) {
      // Reported rather than thrown, because part of the job is already done
      // and saying so is more use than a stack trace over a file that exists.
      const message = e instanceof Error ? e.message : String(e);
      console.error(summary);
      console.error(`Wrote ${opts.outMerged}`);
      console.error(`⚠ The tree report failed: ${message}`);
      if (e instanceof RangeError) {
        console.error(
          '  A long import chain overruns the stack while the tree is built. The merged report above covers the same scan.'
        );
      }
      process.exitCode = 1;
      return;
    }

    console.error(summary);
    console.error(`Wrote ${opts.outTree} and ${opts.outMerged}`);
    for (const w of result.warnings) console.error(`⚠ ${w}`);

    if (opts.json) {
      fs.writeFileSync(opts.json, JSON.stringify(result, null, 2));
      console.error(`Also wrote raw graph JSON to ${opts.json}`);
    }
    if (opts.open) {
      openInBrowser(opts.outTree);
      openInBrowser(opts.outMerged);
    }
  });

program.parse();
