import type { TreeRenderData } from "../types";
import type { RenderNode } from "./client/types";
import { byId } from "./client/dom";
import { createColorScale } from "./client/colors";
import { highlightLayer, renderSidebar } from "./client/sidebar";
import {
  buildIndex,
  countDescendants,
  createCollapsedState,
} from "./client/tree";
import { createViewport } from "./client/viewport";
import { showDetail } from "./client/detail";
import { createTreeRenderer } from "./client/svgTree";
import { createNavigation, type Navigation } from "./client/navigation";
import { createSearch } from "./client/search";
import { renderFindings } from "./client/findings";
import { createTabs } from "./client/tabs";

declare global {
  interface Window {
    __IMPORT_ATLAS_DATA__: TreeRenderData;
  }
}

const DATA = window.__IMPORT_ATLAS_DATA__;
// The payload carries only the base TreeNode fields; the pipeline below
// fills in the scratch ones (`_count`, `depth`, `x`, `y`) before any read.
const forest = DATA.forest as unknown as RenderNode[];

const colorOf = createColorScale(DATA.layers);
renderSidebar(DATA, colorOf);
renderFindings(DATA);

const { byId: nodeById, parentOf } = buildIndex(forest);
countDescendants(forest, nodeById);
const { collapsed, defaultCollapse } = createCollapsedState(forest);

const svg = byId<SVGSVGElement>("canvas");
const viewportG = byId<SVGGElement>("viewport");
const edgesG = byId<SVGGElement>("edges");
const nodesG = byId<SVGGElement>("nodes");

const viewport = createViewport(svg, viewportG);

const tabs = createTabs();

let nav: Navigation;
const treeRenderer = createTreeRenderer({
  forest,
  edgesG,
  nodesG,
  colorOf,
  collapsed,
  onActivate: (node) => nav.onNodeActivate(node),
  onLayerHover: highlightLayer,
});

const toggleExpandBtn = byId<HTMLButtonElement>("toggleExpand");
const toggleExpandText = byId("toggleExpandText");

// Derived from the live `collapsed` set rather than a flag of its own, so
// it can't drift: clicking individual nodes mutates `collapsed` too.
function renderToggleExpand(): void {
  const isFullyExpanded = collapsed.size === 0;
  toggleExpandBtn.setAttribute("aria-checked", String(isFullyExpanded));
  toggleExpandText.textContent = isFullyExpanded ? "Expanded" : "Collapsed";
}

// Anything that changes `collapsed` must re-render the tree AND resync the
// switch — routed through one function so neither path forgets the other.
function renderTree(): void {
  treeRenderer.render();
  renderToggleExpand();
}
renderToggleExpand();

toggleExpandBtn.addEventListener("click", () => {
  tabs.showCanvas();
  if (collapsed.size === 0) {
    defaultCollapse();
  } else {
    collapsed.clear();
  }
  renderTree();
  viewport.fitView(treeRenderer.getVisibleNodes());
});

nav = createNavigation({
  collapsed,
  byId: nodeById,
  parentOf,
  render: renderTree,
  svg,
  nodesG,
  viewport,
  showDetail: (node) => showDetail(node, colorOf),
});

byId("zoomIn").addEventListener("click", () => {
  viewport.zoomStep(1.2);
});
byId("zoomOut").addEventListener("click", () => {
  viewport.zoomStep(1 / 1.2);
});

byId("fitView").addEventListener("click", () => {
  tabs.showCanvas();
  viewport.fitView(treeRenderer.getVisibleNodes());
});

createSearch({
  byId: nodeById,
  searchInput: byId<HTMLInputElement>("search"),
  searchHint: byId("searchHint"),
  // The tree can afford to open on every keystroke: it unfolds only the
  // one match's ancestors, and the same chevrons fold them back.
  jumpTo: (id) => {
    tabs.showCanvas();
    nav.jumpTo(id);
  },
});

renderTree();
requestAnimationFrame(() => {
  viewport.fitView(treeRenderer.getVisibleNodes());
});
