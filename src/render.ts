import type { ScanResult, TreeNode } from './types';

export interface RenderOptions {
  title: string;
}

interface RenderData {
  title: string;
  root: string;
  entries: string[];
  layers: string[];
  layerCounts: Record<string, number>;
  topFanIn: { path: string; count: number }[];
  warnings: string[];
  forest: TreeNode[];
  generatedAt: string;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Renders a self-contained HTML file: a pannable, collapsible SVG tree of the scanned graph. */
export function renderHtml(forest: TreeNode[], scanResult: ScanResult, options: RenderOptions): string {
  const layerCounts: Record<string, number> = {};
  for (const node of Object.values(scanResult.nodes)) {
    layerCounts[node.layer] = (layerCounts[node.layer] || 0) + 1;
  }
  const layers = Object.keys(layerCounts).sort((a, b) => layerCounts[b] - layerCounts[a]);

  const topFanIn = Object.entries(scanResult.fanIn)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([id, count]) => ({ path: scanResult.nodes[id]?.relPath || id, count }));

  const data: RenderData = {
    title: options.title,
    root: scanResult.root,
    entries: scanResult.entries.map((id) => scanResult.nodes[id]?.relPath || id),
    layers,
    layerCounts,
    topFanIn,
    warnings: scanResult.warnings,
    forest,
    generatedAt: new Date().toISOString()
  };

  const dataJson = JSON.stringify(data).replace(/</g, '\\u003c');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(options.title)}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style>
${CSS}
</style>
</head>
<body>
${BODY}
<script>
window.__IMPORT_ATLAS_DATA__ = ${dataJson};
${SCRIPT}
</script>
</body>
</html>
`;
}

const CSS = `
  :root{
    --bg:#F4F5F7; --surface:#FFFFFF; --surface-2:#EBEDF1;
    --text:#171A21; --text-muted:#5B6270;
    --border:#D7DAE1; --border-strong:#B9BEC9;
    --highlight:#D69A22; --danger:#B8492E;
    --font-sans:'IBM Plex Sans',system-ui,-apple-system,sans-serif;
    --font-mono:'IBM Plex Mono',ui-monospace,'SFMono-Regular',Menlo,monospace;
  }
  @media (prefers-color-scheme: dark){
    :root{
      --bg:#14161C; --surface:#1C1F27; --surface-2:#20232D;
      --text:#E8E9ED; --text-muted:#9AA0AC;
      --border:#2C303B; --border-strong:#3A3F4C;
      --highlight:#F2C860; --danger:#E0685A;
    }
  }
  *{box-sizing:border-box;}
  html,body{margin:0;height:100%;}
  body{background:var(--bg);color:var(--text);font-family:var(--font-sans);overflow:hidden;}
  .app{display:flex;height:100vh;}
  .sidebar{
    width:310px;flex:0 0 310px;background:var(--surface);border-right:1px solid var(--border);
    display:flex;flex-direction:column;overflow-y:auto;padding:20px 18px 16px;gap:16px;
  }
  .sidebar h1{font-size:16px;font-weight:700;margin:0 0 2px;letter-spacing:-0.01em;}
  .sidebar .subtitle{font-family:var(--font-mono);font-size:10.5px;color:var(--text-muted);margin:0;word-break:break-all;}
  .sidebar section{display:flex;flex-direction:column;gap:8px;}
  .sidebar h2{font-size:10.5px;text-transform:uppercase;letter-spacing:0.07em;color:var(--text-muted);font-weight:600;margin:0;}
  #search{width:100%;font-family:var(--font-mono);font-size:12px;padding:8px 10px;border:1px solid var(--border);border-radius:5px;background:var(--surface-2);color:var(--text);}
  #search:focus{outline:2px solid var(--text-muted);outline-offset:1px;}
  .search-hint{font-size:10.5px;color:var(--text-muted);min-height:13px;}
  .btn-row{display:flex;flex-wrap:wrap;gap:6px;}
  button.ctl{font-family:var(--font-sans);font-size:11.5px;font-weight:500;padding:6px 10px;border-radius:5px;border:1px solid var(--border);background:var(--surface-2);color:var(--text);cursor:pointer;}
  button.ctl:hover{border-color:var(--border-strong);}
  .legend ul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px;max-height:190px;overflow-y:auto;}
  .legend li{display:flex;align-items:center;gap:8px;font-size:12px;font-family:var(--font-mono);}
  .swatch{width:8px;height:8px;border-radius:50%;flex:0 0 auto;}
  .legend .cnt{margin-left:auto;color:var(--text-muted);font-size:10.5px;}
  .ref-row{display:flex;align-items:center;gap:8px;font-size:11.5px;color:var(--text-muted);}
  .ref-swatch{width:14px;height:8px;border:1.5px dashed var(--text-muted);border-radius:3px;flex:0 0 auto;}
  table.stats{width:100%;border-collapse:collapse;font-size:11.5px;}
  table.stats td{padding:3px 0;border-bottom:1px solid var(--border);vertical-align:baseline;}
  table.stats td.mod{font-family:var(--font-mono);color:var(--text);word-break:break-all;}
  table.stats td.n{text-align:right;font-variant-numeric:tabular-nums;color:var(--text-muted);white-space:nowrap;padding-left:8px;}
  table.stats tr:last-child td{border-bottom:none;}
  .warnings{display:flex;flex-direction:column;gap:4px;font-size:11px;color:var(--danger);}
  #detail{border:1px solid var(--border);border-radius:6px;background:var(--surface-2);padding:10px 12px;font-size:12px;display:flex;flex-direction:column;gap:4px;}
  #detail .d-label{font-weight:600;font-size:13px;}
  #detail .d-path{font-family:var(--font-mono);font-size:10.5px;color:var(--text-muted);word-break:break-all;}
  #detail .d-note{font-size:11.5px;color:var(--text);}
  #detail .d-warn{font-size:11px;color:var(--danger);}
  #detail[hidden]{display:none;}
  .hint{margin-top:auto;font-size:10.5px;line-height:1.5;color:var(--text-muted);padding-top:8px;border-top:1px solid var(--border);}
  .canvas-wrap{position:relative;flex:1 1 auto;overflow:hidden;background:radial-gradient(var(--border) 1px, transparent 1px) 0 0/22px 22px, var(--bg);}
  svg#canvas{width:100%;height:100%;display:block;cursor:grab;}
  svg#canvas.dragging{cursor:grabbing;}
  .zoom-controls{position:absolute;right:16px;bottom:16px;display:flex;flex-direction:column;gap:6px;z-index:2;}
  .zoom-controls button{width:30px;height:30px;border-radius:6px;border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:15px;line-height:1;cursor:pointer;box-shadow:0 1px 2px rgba(0,0,0,0.08);}
  .node{cursor:pointer;}
  .node:focus-visible .box{outline:2px solid var(--text-muted);outline-offset:2px;}
  .box{fill:var(--surface);stroke:var(--border-strong);stroke-width:1;}
  .node:hover .box{stroke:var(--text-muted);}
  .node.entry .box{stroke-width:2;}
  .node.is-ref .box{stroke-dasharray:3 2;fill-opacity:0.55;}
  .dot{fill:var(--dot-l);}
  @media (prefers-color-scheme: dark){ .dot{fill:var(--dot-d);} }
  .label{font-family:var(--font-sans);font-size:11.3px;font-weight:600;fill:var(--text);}
  .node.is-ref .label{font-weight:500;fill:var(--text-muted);}
  .chev{font-family:var(--font-mono);font-size:10px;fill:var(--text-muted);}
  .count-badge rect{fill:var(--surface-2);stroke:var(--border);}
  .count-badge text{font-family:var(--font-mono);font-size:9.5px;fill:var(--text-muted);}
  .ref-glyph{font-family:var(--font-sans);font-size:11px;fill:var(--text-muted);}
  .warn-glyph{font-size:10.5px;fill:var(--danger);}
  .edge{fill:none;stroke-width:1.4;opacity:0.55;stroke:var(--dot-l);}
  @media (prefers-color-scheme: dark){ .edge{stroke:var(--dot-d);} }
  @keyframes pulseRing{0%{stroke-opacity:1;stroke-width:2.6;}70%{stroke-opacity:0.15;stroke-width:9;}100%{stroke-opacity:0;stroke-width:11;}}
  .pulse{fill:none;stroke:var(--highlight);animation:pulseRing 1.1s ease-out 2;}
  @media (prefers-reduced-motion: reduce){ .pulse{animation:none;stroke-opacity:0.9;stroke-width:3;} }
  @media (max-width: 820px){
    .app{flex-direction:column;}
    .sidebar{width:auto;flex:0 0 auto;max-height:42vh;border-right:none;border-bottom:1px solid var(--border);}
  }
`;

const BODY = `
<div class="app">
  <aside class="sidebar">
    <div>
      <h1 id="pageTitle"></h1>
      <p class="subtitle" id="pageSubtitle"></p>
    </div>
    <section>
      <h2>Find a file</h2>
      <input id="search" type="text" placeholder="filename or path…" autocomplete="off">
      <div class="search-hint" id="searchHint"></div>
    </section>
    <section>
      <h2>View</h2>
      <div class="btn-row">
        <button class="ctl" id="expandAll" type="button">Expand all</button>
        <button class="ctl" id="collapseDefault" type="button">Collapse</button>
        <button class="ctl" id="fitView" type="button">Fit view</button>
      </div>
    </section>
    <section class="legend">
      <h2>Layers</h2>
      <ul id="legendList"></ul>
      <div class="ref-row"><span class="ref-swatch"></span> dashed = re-used elsewhere, click to jump</div>
    </section>
    <section>
      <h2>Highest fan-in</h2>
      <table class="stats" id="statsTable"></table>
    </section>
    <section id="warningsSection" hidden>
      <h2>Warnings</h2>
      <div class="warnings" id="warningsList"></div>
    </section>
    <div id="detail" hidden>
      <div class="d-label" id="dLabel"></div>
      <div class="d-path" id="dPath"></div>
      <div class="d-note" id="dNote"></div>
      <div class="d-warn" id="dWarn"></div>
    </div>
    <p class="hint">Click a node to expand/collapse. Drag to pan, scroll to zoom. Dashed nodes jump to where the file is fully expanded.</p>
  </aside>
  <main class="canvas-wrap">
    <svg id="canvas" aria-label="Import dependency tree">
      <g id="viewport"><g id="edges"></g><g id="nodes"></g></g>
    </svg>
    <div class="zoom-controls">
      <button type="button" id="zoomIn" aria-label="Zoom in">+</button>
      <button type="button" id="zoomOut" aria-label="Zoom out">&minus;</button>
    </div>
  </main>
</div>
`;

const SCRIPT = `
(function(){
  "use strict";
  var DATA = window.__IMPORT_ATLAS_DATA__;
  document.getElementById('pageTitle').textContent = DATA.title;
  document.getElementById('pageSubtitle').textContent = DATA.root + ' · entries: ' + DATA.entries.join(', ');

  var PALETTE = [
    ['#B8842E','#D9A44E'], ['#2A8C82','#3FB3A8'], ['#4A5FD6','#8B98F5'],
    ['#C4532E','#E37A54'], ['#7A4FC9','#A98CF0'], ['#5E7A33','#8FB35C'],
    ['#2F7FB8','#5FA8E0'], ['#B04384','#E077B5']
  ];
  var NEUTRAL = ['#6B7280','#8D95A5'];
  var layerColor = {};
  DATA.layers.forEach(function(layer, i){
    layerColor[layer] = layer === '(root)' ? NEUTRAL : PALETTE[i % PALETTE.length];
  });
  function colorOf(layer){ return layerColor[layer] || NEUTRAL; }

  var legendList = document.getElementById('legendList');
  DATA.layers.forEach(function(layer){
    var li = document.createElement('li');
    var sw = document.createElement('span');
    sw.className = 'swatch';
    sw.style.background = colorOf(layer)[0];
    li.appendChild(sw);
    li.appendChild(document.createTextNode(layer));
    var cnt = document.createElement('span');
    cnt.className = 'cnt';
    cnt.textContent = DATA.layerCounts[layer];
    li.appendChild(cnt);
    legendList.appendChild(li);
  });

  var statsTable = document.getElementById('statsTable');
  DATA.topFanIn.forEach(function(row){
    var tr = document.createElement('tr');
    var tdMod = document.createElement('td'); tdMod.className = 'mod'; tdMod.textContent = row.path;
    var tdN = document.createElement('td'); tdN.className = 'n'; tdN.textContent = row.count;
    tr.appendChild(tdMod); tr.appendChild(tdN);
    statsTable.appendChild(tr);
  });

  if (DATA.warnings && DATA.warnings.length){
    document.getElementById('warningsSection').hidden = false;
    var wl = document.getElementById('warningsList');
    DATA.warnings.forEach(function(w){
      var d = document.createElement('div');
      d.textContent = '⚠ ' + w;
      wl.appendChild(d);
    });
  }

  var byId = {};
  var parentOf = {};
  function index(node, parent){
    byId[node.renderId] = node;
    if (parent) parentOf[node.renderId] = parent.renderId;
    node.children.forEach(function(c){ index(c, node); });
  }
  DATA.forest.forEach(function(root){ index(root, null); });

  function countDesc(node){
    if (node.ref || !node.children.length){ node._count = 0; return 0; }
    var total = 0;
    node.children.forEach(function(c){ total += 1 + countDesc(c); });
    node._count = total;
    return total;
  }
  DATA.forest.forEach(countDesc);

  var collapsed = new Set();
  function defaultCollapse(){
    collapsed.clear();
    function walk(node, depth){
      if (node.ref) return;
      if (depth >= 1 && node.children.length) collapsed.add(node.renderId);
      node.children.forEach(function(c){ walk(c, depth+1); });
    }
    DATA.forest.forEach(function(root){ walk(root, 0); });
  }
  defaultCollapse();

  var ROW_H = 30, COL_W = 232, NODE_W = 208, NODE_H = 27;
  function shortLabel(s){ return s.length > 28 ? s.slice(0,27) + '…' : s; }

  function buildLayout(root, startY, nodes, edges){
    var cursor = startY;
    function visit(node, depth, parent){
      node.depth = depth;
      node.x = depth * COL_W;
      nodes.push(node);
      if (parent) edges.push([parent, node]);
      var expanded = !node.ref && node.children.length && !collapsed.has(node.renderId);
      if (expanded){
        var ys = node.children.map(function(c){ return visit(c, depth+1, node); });
        node.y = (ys[0] + ys[ys.length-1]) / 2;
      } else {
        node.y = cursor;
        cursor += ROW_H;
      }
      return node.y;
    }
    visit(root, 0, null);
    return cursor;
  }

  var svg = document.getElementById('canvas');
  var viewportG = document.getElementById('viewport');
  var edgesG = document.getElementById('edges');
  var nodesG = document.getElementById('nodes');
  var SVGNS = 'http://www.w3.org/2000/svg';
  var visibleNodes = [], visibleEdges = [];

  function render(){
    visibleNodes = []; visibleEdges = [];
    var nextY = 0;
    DATA.forest.forEach(function(root, i){
      nextY = buildLayout(root, nextY, visibleNodes, visibleEdges);
      nextY += ROW_H * 2.2;
    });

    edgesG.innerHTML = '';
    nodesG.innerHTML = '';

    visibleEdges.forEach(function(pair){
      var p = pair[0], c = pair[1];
      var px = p.x + NODE_W, py = p.y, cx = c.x, cy = c.y;
      var mid = px + Math.max(24, (cx - px) / 2);
      var d = 'M ' + px + ' ' + py + ' H ' + mid + ' V ' + cy + ' H ' + cx;
      var path = document.createElementNS(SVGNS, 'path');
      path.setAttribute('d', d);
      path.setAttribute('class', 'edge');
      var col = colorOf(c.layer);
      path.style.setProperty('--dot-l', col[0]);
      path.style.setProperty('--dot-d', col[1]);
      edgesG.appendChild(path);
    });

    visibleNodes.forEach(function(node){
      var g = document.createElementNS(SVGNS, 'g');
      var classes = ['node'];
      if (node.ref) classes.push('is-ref');
      if (node.depth === 0) classes.push('entry');
      g.setAttribute('class', classes.join(' '));
      g.setAttribute('transform', 'translate(' + node.x + ',' + (node.y - NODE_H/2) + ')');
      g.setAttribute('tabindex', '0');
      g.setAttribute('role', 'button');
      g.dataset.id = node.renderId;
      var fullLabel = node.label + ' — ' + node.relPath;
      g.setAttribute('aria-label', fullLabel + (node.note ? ('. imports ' + node.note) : ''));

      var rect = document.createElementNS(SVGNS, 'rect');
      rect.setAttribute('class', 'box');
      rect.setAttribute('width', NODE_W);
      rect.setAttribute('height', NODE_H);
      rect.setAttribute('rx', 5);
      g.appendChild(rect);

      var col = colorOf(node.layer);
      var dot = document.createElementNS(SVGNS, 'circle');
      dot.setAttribute('class', 'dot');
      dot.style.setProperty('--dot-l', col[0]);
      dot.style.setProperty('--dot-d', col[1]);
      dot.setAttribute('cx', 12);
      dot.setAttribute('cy', NODE_H/2);
      dot.setAttribute('r', 3.6);
      g.appendChild(dot);

      var text = document.createElementNS(SVGNS, 'text');
      text.setAttribute('class', 'label');
      text.setAttribute('x', 24);
      text.setAttribute('y', NODE_H/2 + 4);
      text.textContent = shortLabel(node.label);
      g.appendChild(text);

      var rightX = NODE_W - 10;
      if (node.warn){
        var w = document.createElementNS(SVGNS, 'text');
        w.setAttribute('class', 'warn-glyph');
        w.setAttribute('x', rightX - (node.ref || node.children.length ? 14 : 0));
        w.setAttribute('y', NODE_H/2 + 4);
        w.setAttribute('text-anchor', 'end');
        w.textContent = '⚠';
        g.appendChild(w);
      }

      if (node.ref){
        var r = document.createElementNS(SVGNS, 'text');
        r.setAttribute('class', 'ref-glyph');
        r.setAttribute('x', rightX);
        r.setAttribute('y', NODE_H/2 + 4);
        r.setAttribute('text-anchor', 'end');
        r.textContent = '↗';
        g.appendChild(r);
      } else if (node.children.length){
        var chev = document.createElementNS(SVGNS, 'text');
        chev.setAttribute('class', 'chev');
        chev.setAttribute('x', rightX);
        chev.setAttribute('y', NODE_H/2 + 4);
        chev.setAttribute('text-anchor', 'end');
        chev.textContent = collapsed.has(node.renderId) ? '▸' : '▾';
        g.appendChild(chev);

        if (collapsed.has(node.renderId) && node._count > 0){
          var bg = document.createElementNS(SVGNS, 'g');
          bg.setAttribute('class', 'count-badge');
          var bw = 10 + String(node._count).length * 6.5;
          var brect = document.createElementNS(SVGNS, 'rect');
          brect.setAttribute('x', rightX - 14 - bw);
          brect.setAttribute('y', NODE_H/2 - 8);
          brect.setAttribute('width', bw);
          brect.setAttribute('height', 16);
          brect.setAttribute('rx', 8);
          bg.appendChild(brect);
          var btext = document.createElementNS(SVGNS, 'text');
          btext.setAttribute('x', rightX - 14 - bw/2);
          btext.setAttribute('y', NODE_H/2 + 4);
          btext.setAttribute('text-anchor', 'middle');
          btext.textContent = node._count;
          bg.appendChild(btext);
          g.appendChild(bg);
        }
      }

      var title = document.createElementNS(SVGNS, 'title');
      title.textContent = fullLabel + (node.note ? ('\\nimports: ' + node.note) : '') + (node.warn ? ('\\n⚠ ' + node.warn) : '') + (node.fanIn > 1 ? ('\\nfan-in: ' + node.fanIn) : '');
      g.appendChild(title);

      g.addEventListener('click', function(){ onNodeActivate(node); });
      g.addEventListener('keydown', function(e){
        if (e.key === 'Enter' || e.key === ' '){ e.preventDefault(); onNodeActivate(node); }
      });

      nodesG.appendChild(g);
    });
  }

  function onNodeActivate(node){
    showDetail(node);
    if (node.ref){ jumpTo(node.ref); return; }
    if (node.children.length){
      if (collapsed.has(node.renderId)) collapsed.delete(node.renderId); else collapsed.add(node.renderId);
      render();
    }
  }

  function showDetail(node){
    var box = document.getElementById('detail');
    box.hidden = false;
    document.getElementById('dLabel').textContent = node.label;
    document.getElementById('dPath').textContent = node.relPath;
    document.getElementById('dNote').textContent = node.note && !node.ref ? ('imports: ' + node.note) : (node.ref ? 'Re-used elsewhere — click jumps to its definition.' : '');
    document.getElementById('dWarn').textContent = node.warn ? ('⚠ ' + node.warn) : '';
  }

  var view = { x: 36, y: 36, k: 1 };
  function applyTransform(){ viewportG.setAttribute('transform', 'translate(' + view.x + ',' + view.y + ') scale(' + view.k + ')'); }
  function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }

  svg.addEventListener('wheel', function(e){
    e.preventDefault();
    var rect = svg.getBoundingClientRect();
    var mx = e.clientX - rect.left, my = e.clientY - rect.top;
    var factor = e.deltaY < 0 ? 1.12 : 1/1.12;
    var newK = clamp(view.k * factor, 0.15, 3);
    var wx = (mx - view.x) / view.k, wy = (my - view.y) / view.k;
    view.k = newK; view.x = mx - wx*newK; view.y = my - wy*newK;
    applyTransform();
  }, { passive:false });

  var dragging = false, dragStart = null;
  var DRAG_THRESHOLD = 4;
  svg.addEventListener('pointerdown', function(e){
    dragStart = { x:e.clientX, y:e.clientY, vx:view.x, vy:view.y, id:e.pointerId };
    dragging = false;
  });
  svg.addEventListener('pointermove', function(e){
    if (!dragStart) return;
    var dx = e.clientX - dragStart.x, dy = e.clientY - dragStart.y;
    if (!dragging && (Math.abs(dx)+Math.abs(dy)) > DRAG_THRESHOLD){
      dragging = true;
      svg.classList.add('dragging');
      svg.setPointerCapture(dragStart.id);
    }
    if (dragging){ view.x = dragStart.vx+dx; view.y = dragStart.vy+dy; applyTransform(); }
  });
  function endDrag(){
    if (dragging){
      svg.classList.remove('dragging');
      try { svg.releasePointerCapture(dragStart.id); } catch(e){}
    }
    dragging = false; dragStart = null;
  }
  svg.addEventListener('pointerup', endDrag);
  svg.addEventListener('pointercancel', endDrag);
  svg.addEventListener('pointerleave', function(){ if (!dragging) dragStart = null; });

  document.getElementById('zoomIn').addEventListener('click', function(){ zoomStep(1.2); });
  document.getElementById('zoomOut').addEventListener('click', function(){ zoomStep(1/1.2); });
  function zoomStep(factor){
    var rect = svg.getBoundingClientRect();
    var mx = rect.width/2, my = rect.height/2;
    var newK = clamp(view.k*factor, 0.15, 3);
    var wx=(mx-view.x)/view.k, wy=(my-view.y)/view.k;
    view.k=newK; view.x=mx-wx*newK; view.y=my-wy*newK;
    applyTransform();
  }

  function fitView(){
    if (!visibleNodes.length) return;
    var minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
    visibleNodes.forEach(function(n){
      minX=Math.min(minX,n.x); maxX=Math.max(maxX,n.x+NODE_W);
      minY=Math.min(minY,n.y-NODE_H/2); maxY=Math.max(maxY,n.y+NODE_H/2);
    });
    var rect = svg.getBoundingClientRect();
    var pad = 40;
    var k = clamp(Math.min((rect.width-pad*2)/(maxX-minX), (rect.height-pad*2)/(maxY-minY)), 0.15, 1.4);
    view.k=k; view.x=pad-minX*k; view.y=pad-minY*k;
    applyTransform();
  }

  function expandAncestors(id){
    var cur = parentOf[id];
    while (cur){ collapsed.delete(cur); cur = parentOf[cur]; }
  }

  function jumpTo(id){
    expandAncestors(id);
    render();
    var node = byId[id];
    if (!node) return;
    var rect = svg.getBoundingClientRect();
    var k = clamp(view.k, 0.6, 1.2);
    view.k = k;
    view.x = rect.width/2 - (node.x+NODE_W/2)*k;
    view.y = rect.height/2 - node.y*k;
    applyTransform();
    showDetail(node);
    setTimeout(function(){
      var el = nodesG.querySelector('[data-id="'+id+'"] .box');
      if (!el) return;
      var ring = document.createElementNS(SVGNS,'rect');
      ring.setAttribute('class','pulse');
      ring.setAttribute('x',-3); ring.setAttribute('y',-3);
      ring.setAttribute('width',NODE_W+6); ring.setAttribute('height',NODE_H+6);
      ring.setAttribute('rx',8);
      el.parentNode.appendChild(ring);
      setTimeout(function(){ ring.remove(); }, 2400);
    }, 30);
  }

  document.getElementById('expandAll').addEventListener('click', function(){ collapsed.clear(); render(); fitView(); });
  document.getElementById('collapseDefault').addEventListener('click', function(){ defaultCollapse(); render(); fitView(); });
  document.getElementById('fitView').addEventListener('click', fitView);

  var allNodes = Object.keys(byId).map(function(k){ return byId[k]; });
  var searchInput = document.getElementById('search');
  var searchHint = document.getElementById('searchHint');
  var matches = [], matchIdx = -1;
  searchInput.addEventListener('input', function(){
    var q = searchInput.value.trim().toLowerCase();
    if (!q){ matches=[]; matchIdx=-1; searchHint.textContent=''; return; }
    matches = allNodes.filter(function(n){
      return n.label.toLowerCase().indexOf(q)!==-1 || n.relPath.toLowerCase().indexOf(q)!==-1;
    });
    matchIdx = matches.length ? 0 : -1;
    searchHint.textContent = matches.length ? (matches.length+' match'+(matches.length>1?'es':'')+' — press Enter to jump') : 'No matches';
    if (matches.length) jumpTo(matches[0].renderId);
  });
  searchInput.addEventListener('keydown', function(e){
    if (e.key==='Enter' && matches.length){
      matchIdx = (matchIdx+1) % matches.length;
      jumpTo(matches[matchIdx].renderId);
      searchHint.textContent = 'Match '+(matchIdx+1)+' of '+matches.length+' — press Enter for next';
    }
  });

  render();
  requestAnimationFrame(fitView);
})();
`;
