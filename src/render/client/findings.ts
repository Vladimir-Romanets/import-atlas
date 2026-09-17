import type { Finding, ReportMeta } from '../../types';
import { byId } from './dom';
import { initHelpModal, showHelp } from './findingsHelpModal';
import { HELP_HTML } from './helpContent.generated';

/**
 * Grouped by kind AND confidence, not confidence alone: the four `high`
 * kinds call for different fixes (drop an `export`, delete a re-export
 * line, break a cycle, consolidate an import), and the group header prints
 * that advice once instead of on all 500 rows.
 */
const GROUP_LABELS: Record<string, string> = {
  'dead-export-high': 'Unimported exports',
  'dead-export-medium': 'Named exports duplicating an imported default',
  'dead-export-low': 'Names reached through a default object',
  'dead-reexport-high': 'Unimported re-exports',
  'circular-import-high': 'Circular imports',
  'dupe-import-high': 'Duplicate imports',
  'layer-violation-high': 'Layer boundary violations',
};

interface Group {
  key: string;
  label: string;
  recommendation: string;
  items: Finding[];
}

function groupFindings(findings: Finding[]): Group[] {
  const order: string[] = [];
  const byKey: Record<string, Group> = {};
  // `findings` arrives sorted most trustworthy first across every detector
  // (see `sortFindings`), so first-seen order is the order to render in.
  for (const finding of findings) {
    const key = `${finding.kind}-${finding.confidence}`;
    if (!byKey[key]) {
      byKey[key] = {
        key,
        label: GROUP_LABELS[key] ?? key,
        recommendation: finding.recommendation,
        items: [],
      };
      order.push(key);
    }
    byKey[key].items.push(finding);
  }
  return order.map((key) => byKey[key]);
}

function renderGroup(group: Group): { section: HTMLElement; rows: { el: HTMLElement; haystack: string }[] } {
  const section = document.createElement('section');
  section.className = 'f-group';

  const heading = document.createElement('h3');
  heading.textContent = group.label;
  const count = document.createElement('span');
  count.className = 'count';
  count.textContent = String(group.items.length);
  heading.appendChild(count);

  // group.key ("dead-export-low") doubles as its help file's slug
  // (src/render/client/help/dead-export-low.html) — no file, no icon.
  const help = HELP_HTML[group.key];
  if (help) {
    const helpBtn = document.createElement('button');
    helpBtn.type = 'button';
    helpBtn.className = 'f-help';
    helpBtn.textContent = '?';
    helpBtn.setAttribute('aria-label', `What does "${group.label}" mean?`);
    helpBtn.addEventListener('click', () => showHelp(help, helpBtn));
    heading.appendChild(helpBtn);
  }

  section.appendChild(heading);

  const advice = document.createElement('p');
  advice.className = 'f-advice';
  advice.textContent = group.recommendation;
  section.appendChild(advice);

  const table = document.createElement('table');
  table.className = 'f-table';
  const rows: { el: HTMLElement; haystack: string }[] = [];

  // Every other group's `recommendation` is one fixed string shared by the
  // whole group, so the advice paragraph above already says all there is to
  // say and `reason` only repeats it in the tooltip. `layer-violation` is the
  // exception — its `reason` names the specific layers and file a generic
  // group-level blurb can't, so it earns a column of its own instead of
  // staying hover-only. Its first column also swaps to the source layer
  // instead of `finding.name`: for this kind `name` is the target file's
  // path, which the reason column already spells out in full — repeating it
  // in column one added nothing, while the source layer is what a reader
  // scanning down the group actually wants to group by.
  const showReasonColumn = group.items[0]?.kind === 'layer-violation';

  for (const finding of group.items) {
    const tr = document.createElement('tr');
    const firstColumn = showReasonColumn ? finding.layer : finding.name;

    const name = document.createElement('td');
    name.className = 'f-name';
    name.textContent = firstColumn;
    tr.appendChild(name);

    const path = document.createElement('td');
    path.className = 'f-path';
    path.textContent = finding.relPath;
    tr.appendChild(path);

    let haystack = `${firstColumn}\n${finding.relPath}`;
    if (showReasonColumn) {
      const reason = document.createElement('td');
      reason.className = 'f-reason';
      reason.textContent = finding.reason;
      tr.appendChild(reason);
      haystack += `\n${finding.reason}`;
    } else {
      tr.title = finding.reason;
    }

    table.appendChild(tr);
    rows.push({ el: tr, haystack: haystack.toLowerCase() });
  }

  section.appendChild(table);
  return { section, rows };
}

export function renderFindings(data: ReportMeta): void {
  initHelpModal();

  const findings = data.findings;
  byId('findingsCount').textContent = String(findings.length);

  // A cycle row is filed under one anchor but implicates its whole
  // component: counting `fileId` alone would report two eight-file cycles
  // as touching two files.
  const files = new Set<string>();
  for (const finding of findings) {
    for (const id of finding.fileIds ?? [finding.fileId]) files.add(id);
  }
  const fileCount = files.size;
  byId('findingsSummary').textContent = findings.length
    ? `${findings.length} finding${findings.length > 1 ? 's' : ''} across ${fileCount} file${fileCount > 1 ? 's' : ''}.`
    : 'Nothing to flag: no unimported exports, circular imports, duplicate imports, or layer violations found.';

  // Unlike the tree's node pruning, the list still runs on a graph with
  // holes — but a reader weighing a row deserves to know that a file which
  // could have imported the name was never read.
  if (data.coverageGaps.length) {
    const caveat = byId('findingsCaveat');
    caveat.hidden = false;
    caveat.textContent = `⚠ The scan missed import edges (${data.coverageGaps.join('; ')}). A file it never read could be the one importing a name listed below.`;
  }

  const groupsEl = byId('findingsGroups');
  const filterInput = byId<HTMLInputElement>('findingsFilter');
  if (!findings.length) {
    filterInput.hidden = true;
    return;
  }

  const allRows: { el: HTMLElement; haystack: string }[] = [];
  const sections: { el: HTMLElement; rows: { el: HTMLElement; haystack: string }[] }[] = [];
  for (const group of groupFindings(findings)) {
    const { section, rows } = renderGroup(group);
    groupsEl.appendChild(section);
    sections.push({ el: section, rows });
    allRows.push(...rows);
  }

  const noMatches = byId('findingsNoMatches');
  filterInput.addEventListener('input', () => {
    const query = filterInput.value.trim().toLowerCase();
    let visible = 0;
    for (const { el, haystack } of allRows) {
      const match = !query || haystack.indexOf(query) !== -1;
      el.hidden = !match;
      if (match) visible++;
    }
    // Otherwise a fully filtered-out group leaves its heading and advice
    // floating above nothing.
    for (const section of sections) {
      section.el.hidden = !section.rows.some((row) => !row.el.hidden);
    }
    noMatches.hidden = visible > 0;
  });
}
