import type { GraphRenderData } from "../types";
import { createColorScale } from "./client/colors";
import { NODE_H, NODE_W, SVGNS } from "./client/constants";
import { byId } from "./client/dom";
import { renderFindings } from "./client/findings";
import { showGraphDetail } from "./client/graph/detail";
import { createGraphRenderer } from "./client/graph/graphRenderer";
import { buildGraphIndex } from "./client/graph/types";
import { createVisibility } from "./client/graph/visibility";
import { createSearch } from "./client/search";
import { highlightLayer, renderSidebar } from "./client/sidebar";
import { createTabs } from "./client/tabs";
import { createViewport } from "./client/viewport";

// Read rather than declared as a global: the tree viewer declares the same
// `window` property with its own payload type, and both entry points are
// checked as one program.
const DATA = (window as unknown as { __IMPORT_ATLAS_DATA__: GraphRenderData })
  .__IMPORT_ATLAS_DATA__;

const graph = DATA.graph;
const index = buildGraphIndex(graph.nodes, graph.edges);

const colorOf = createColorScale(DATA.layers);
renderSidebar(DATA, colorOf);
renderFindings(DATA);

const svg = byId<SVGSVGElement>("canvas");
const viewportG = byId<SVGGElement>("viewport");
const edgesG = byId<SVGGElement>("edges");
const nodesG = byId<SVGGElement>("nodes");
const edgesHoverG = byId<SVGGElement>("edges-hover");
const nodesHoverG = byId<SVGGElement>("nodes-hover");

const viewport = createViewport(svg, viewportG);
const visibility = createVisibility(graph, index);

const tabs = createTabs();

const toggleExpandBtn = byId<HTMLButtonElement>("toggleExpand");
const toggleExpandText = byId("toggleExpandText");

// Read off live visibility rather than kept as a flag, and hung on
// `onVisibilityChange` rather than called beside each mutation: most of what
// opens and closes nodes is the renderer's own chevrons and badges, which
// never come through this file but do all refresh.
function renderToggleExpand(): void {
  const isFullyExpanded = visibility.isFullyExpanded();
  toggleExpandBtn.setAttribute("aria-checked", String(isFullyExpanded));
  toggleExpandText.textContent = isFullyExpanded ? "Expanded" : "Collapsed";
}

const renderer = createGraphRenderer({
  index,
  visibility,
  svg,
  edgesG,
  nodesG,
  edgesHoverG,
  nodesHoverG,
  colorOf,
  viewport,
  onSelect: (node) => {
    if (node !== null) showGraphDetail(node, index, colorOf);
  },
  onVisibilityChange: renderToggleExpand,
  onLayerHover: highlightLayer,
});

toggleExpandBtn.addEventListener("click", () => {
  tabs.showCanvas();
  if (visibility.isFullyExpanded()) visibility.collapseAll();
  else visibility.expandAll();
  renderer.refresh();
  viewport.fitView(renderer.laidOut());
});

byId("zoomIn").addEventListener("click", () => {
  viewport.zoomStep(1.2);
});
byId("zoomOut").addEventListener("click", () => {
  viewport.zoomStep(1 / 1.2);
});
byId("fitView").addEventListener("click", () => {
  tabs.showCanvas();
  viewport.fitView(renderer.laidOut());
});

function jumpTo(id: string, committed: boolean): void {
  tabs.showCanvas();
  if (committed) {
    // Opening the way in adds nodes, so the layout has to be redone before
    // there is a position to centre on.
    if (!visibility.reveal(id)) return;
    // The route opened to reach a file is the least interesting thing about
    // a widely shared one. Draw everything that imports it instead — what
    // someone searching for `shared/api` came to find out.
    visibility.showImporters(id);
    renderer.refresh();
  }

  // While the reader is still typing, a match that isn't on the canvas goes
  // unshown: both calls above outlive the keystroke that made them, and
  // half-typed queries match files nobody went looking for.
  const node = renderer.nodeAt(id);
  if (node === undefined) return;

  const rect = svg.getBoundingClientRect();
  const k = viewport.clamp(viewport.view.k, 0.6, 1.2);
  viewport.view.k = k;
  viewport.view.x = rect.width / 2 - (node.x + NODE_W / 2) * k;
  viewport.view.y = rect.height / 2 - node.y * k;
  viewport.applyTransform();

  renderer.select(id);
  showGraphDetail(node, index, colorOf);

  // The ring marks an arrival. It lasts far longer than a keystroke, so
  // only a committed jump earns one.
  if (!committed) return;

  setTimeout(() => {
    const box = nodesG.querySelector(`[data-id="${id}"] .box`);
    if (box === null) return;
    const ring = document.createElementNS(SVGNS, "rect");
    ring.setAttribute("class", "pulse");
    ring.setAttribute("x", "-3");
    ring.setAttribute("y", "-3");
    ring.setAttribute("width", String(NODE_W + 6));
    ring.setAttribute("height", String(NODE_H + 6));
    ring.setAttribute("rx", "8");
    box.parentNode!.appendChild(ring);
    setTimeout(() => {
      ring.remove();
    }, 2400);
  }, 30);
}

createSearch({
  byId: index.nodeById,
  searchInput: byId<HTMLInputElement>("search"),
  searchHint: byId("searchHint"),
  jumpTo,
});

renderer.refresh();
requestAnimationFrame(() => {
  viewport.fitView(renderer.laidOut());
});
