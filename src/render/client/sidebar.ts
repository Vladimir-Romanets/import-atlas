import type { RenderData } from '../../types';
import type { ColorPair } from './types';
import { byId } from './dom';

export function renderSidebar(DATA: RenderData, colorOf: (layer: string) => ColorPair): void {
  byId('pageTitle').textContent = DATA.title;
  byId('pageSubtitle').textContent = `${DATA.root} · entries: ${DATA.entries.join(', ')}`;

  const legendList = byId('legendList');
  DATA.layers.forEach((layer) => {
    const li = document.createElement('li');
    const sw = document.createElement('span');
    sw.className = 'swatch';
    sw.style.background = colorOf(layer)[0];
    li.appendChild(sw);
    li.appendChild(document.createTextNode(layer));
    const cnt = document.createElement('span');
    cnt.className = 'cnt';
    cnt.textContent = String(DATA.layerCounts[layer]);
    li.appendChild(cnt);
    legendList.appendChild(li);
  });

  const statsTable = byId('statsTable');
  DATA.topFanIn.forEach((row) => {
    const tr = document.createElement('tr');
    const tdMod = document.createElement('td');
    tdMod.className = 'mod';
    tdMod.textContent = row.path;
    const tdN = document.createElement('td');
    tdN.className = 'n';
    tdN.textContent = String(row.count);
    tr.appendChild(tdMod);
    tr.appendChild(tdN);
    statsTable.appendChild(tr);
  });

  if (DATA.warnings && DATA.warnings.length){
    byId('warningsSection').hidden = false;
    const wl = byId('warningsList');
    DATA.warnings.forEach((w) => {
      const d = document.createElement('div');
      d.textContent = `⚠ ${w}`;
      wl.appendChild(d);
    });
  }
}
