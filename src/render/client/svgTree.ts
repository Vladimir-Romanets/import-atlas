import { SVGNS, ROW_H, NODE_W, NODE_H } from './constants';
import { buildLayout, shortLabel } from './layout';
import type { ColorPair, RenderNode } from './types';

export interface TreeRenderer {
  render: () => void;
  getVisibleNodes: () => RenderNode[];
}

export interface TreeRendererOptions {
  forest: RenderNode[];
  edgesG: SVGGElement;
  nodesG: SVGGElement;
  colorOf: (layer: string) => ColorPair;
  collapsed: Set<string>;
  onActivate: (node: RenderNode) => void;
}

export function createTreeRenderer({ forest, edgesG, nodesG, colorOf, collapsed, onActivate }: TreeRendererOptions): TreeRenderer {
  let visibleNodes: RenderNode[] = [];
  let visibleEdges: [RenderNode, RenderNode][] = [];

  const renderEdge = ([p, c]: [RenderNode, RenderNode]) => {
    const px = p.x + NODE_W;
    const py = p.y;
    const cx = c.x;
    const cy = c.y;
    const mid = px + Math.max(24, (cx - px) / 2);
    const d = `M ${px} ${py} H ${mid} V ${cy} H ${cx}`;
    const path = document.createElementNS(SVGNS, 'path');
    path.setAttribute('d', d);
    path.setAttribute('class', 'edge');
    const col = colorOf(c.layer);
    path.style.setProperty('--dot-l', col[0]);
    path.style.setProperty('--dot-d', col[1]);
    edgesG.appendChild(path);
  };

  const renderNode = (node: RenderNode) => {
    const g = document.createElementNS(SVGNS, 'g');
    const classes = ['node'];
    if (node.ref) classes.push('is-ref');
    if (node.depth === 0) classes.push('entry');
    g.setAttribute('class', classes.join(' '));
    g.setAttribute('transform', `translate(${node.x},${node.y - NODE_H/2})`);
    g.setAttribute('tabindex', '0');
    g.setAttribute('role', 'button');
    g.dataset.id = node.renderId;
    const fullLabel = `${node.label} — ${node.relPath}`;
    g.setAttribute('aria-label', `${fullLabel}${node.note ? `. imports ${node.note}` : ''}`);

    const rect = document.createElementNS(SVGNS, 'rect');
    rect.setAttribute('class', 'box');
    rect.setAttribute('width', String(NODE_W));
    rect.setAttribute('height', String(NODE_H));
    rect.setAttribute('rx', '5');
    g.appendChild(rect);

    const col = colorOf(node.layer);
    const dot = document.createElementNS(SVGNS, 'circle');
    dot.setAttribute('class', 'dot');
    dot.style.setProperty('--dot-l', col[0]);
    dot.style.setProperty('--dot-d', col[1]);
    dot.setAttribute('cx', '12');
    dot.setAttribute('cy', String(NODE_H/2));
    dot.setAttribute('r', '3.6');
    g.appendChild(dot);

    const text = document.createElementNS(SVGNS, 'text');
    text.setAttribute('class', 'label');
    text.setAttribute('x', '24');
    text.setAttribute('y', String(NODE_H/2 + 4));
    text.textContent = shortLabel(node.label);
    g.appendChild(text);

    const rightX = NODE_W - 10;
    if (node.warn){
      const w = document.createElementNS(SVGNS, 'text');
      w.setAttribute('class', 'warn-glyph');
      w.setAttribute('x', String(rightX - (node.ref || node.children.length ? 14 : 0)));
      w.setAttribute('y', String(NODE_H/2 + 4));
      w.setAttribute('text-anchor', 'end');
      w.textContent = '⚠';
      g.appendChild(w);
    }

    if (node.ref){
      const r = document.createElementNS(SVGNS, 'text');
      r.setAttribute('class', 'ref-glyph');
      r.setAttribute('x', String(rightX));
      r.setAttribute('y', String(NODE_H/2 + 4));
      r.setAttribute('text-anchor', 'end');
      r.textContent = '↗';
      g.appendChild(r);
    } else if (node.children.length){
      const chev = document.createElementNS(SVGNS, 'text');
      chev.setAttribute('class', 'chev');
      chev.setAttribute('x', String(rightX));
      chev.setAttribute('y', String(NODE_H/2 + 4));
      chev.setAttribute('text-anchor', 'end');
      chev.textContent = collapsed.has(node.renderId) ? '▸' : '▾';
      g.appendChild(chev);

      if (collapsed.has(node.renderId) && node._count > 0){
        const bg = document.createElementNS(SVGNS, 'g');
        bg.setAttribute('class', 'count-badge');
        const bw = 10 + String(node._count).length * 6.5;
        const brect = document.createElementNS(SVGNS, 'rect');
        brect.setAttribute('x', String(rightX - 14 - bw));
        brect.setAttribute('y', String(NODE_H/2 - 8));
        brect.setAttribute('width', String(bw));
        brect.setAttribute('height', '16');
        brect.setAttribute('rx', '8');
        bg.appendChild(brect);
        const btext = document.createElementNS(SVGNS, 'text');
        btext.setAttribute('x', String(rightX - 14 - bw/2));
        btext.setAttribute('y', String(NODE_H/2 + 4));
        btext.setAttribute('text-anchor', 'middle');
        btext.textContent = String(node._count);
        bg.appendChild(btext);
        g.appendChild(bg);
      }
    }

    const title = document.createElementNS(SVGNS, 'title');
    title.textContent = `${fullLabel}${node.note ? `\nimports: ${node.note}` : ''}${node.warn ? `\n⚠ ${node.warn}` : ''}${node.fanIn > 1 ? `\nfan-in: ${node.fanIn}` : ''}`;
    g.appendChild(title);

    g.addEventListener('click', () => { onActivate(node); });
    g.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' '){
        e.preventDefault();
        onActivate(node);
      }
    });

    nodesG.appendChild(g);
  };

  const render = () => {
    visibleNodes = [];
    visibleEdges = [];
    let nextY = 0;
    forest.forEach((root) => {
      nextY = buildLayout(root, nextY, visibleNodes, visibleEdges, collapsed);
      nextY += ROW_H * 2.2;
    });

    edgesG.innerHTML = '';
    nodesG.innerHTML = '';

    visibleEdges.forEach(renderEdge);
    visibleNodes.forEach(renderNode);
  };

  return { render, getVisibleNodes: () => visibleNodes };
}
