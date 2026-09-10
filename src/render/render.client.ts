import type { RenderData } from "../types";
import type { RenderNode } from "./client/types";
import { byId } from "./client/dom";
import { createColorScale } from "./client/colors";
import { renderSidebar } from "./client/sidebar";
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

declare global {
  interface Window {
    __IMPORT_ATLAS_DATA__: RenderData;
  }
}

const DATA = window.__IMPORT_ATLAS_DATA__;
// The raw payload only carries the base TreeNode fields; the layout/render
// pipeline below fills in the scratch fields (`_count`, `depth`, `x`, `y`)
// before anything reads them.
const forest = DATA.forest as unknown as RenderNode[];

const colorOf = createColorScale(DATA.layers);
renderSidebar(DATA, colorOf);
renderFindings(DATA);

const { byId: nodeById, parentOf } = buildIndex(forest);
let hideUnused = false;
countDescendants(forest, hideUnused);
const { collapsed, defaultCollapse } = createCollapsedState(forest);

const svg = byId<SVGSVGElement>("canvas");
const viewportG = byId<SVGGElement>("viewport");
const edgesG = byId<SVGGElement>("edges");
const nodesG = byId<SVGGElement>("nodes");

const viewport = createViewport(svg, viewportG);

const tabTree = byId<HTMLButtonElement>("tabTree");
const tabFindings = byId<HTMLButtonElement>("tabFindings");
const panelTree = byId("panelTree");
const panelFindings = byId("panelFindings");

function activateTab(tab: "tree" | "findings"): void {
  const tree = tab === "tree";
  tabTree.setAttribute("aria-selected", String(tree));
  tabFindings.setAttribute("aria-selected", String(!tree));
  panelTree.hidden = !tree;
  panelFindings.hidden = tree;
}

tabTree.addEventListener("click", () => {
  activateTab("tree");
});
tabFindings.addEventListener("click", () => {
  activateTab("findings");
});

// Every viewport operation measures the SVG to work out where to pan or
// zoom to, and a panel that isn't showing measures 0×0 — which would leave
// the tree parked at a nonsense transform. The sidebar's tree controls stay
// clickable while the Findings tab is up, so they switch back to the tree
// first rather than being disabled.
function showTree(): void {
  activateTab("tree");
}

let nav: Navigation;
const treeRenderer = createTreeRenderer({
  forest,
  edgesG,
  nodesG,
  colorOf,
  collapsed,
  onActivate: (node) => nav.onNodeActivate(node),
  getHideUnused: () => hideUnused,
});

const toggleExpandBtn = byId<HTMLButtonElement>("toggleExpand");
const toggleExpandText = byId("toggleExpandText");

// Derived from the live `collapsed` set (not a separately tracked flag) so
// it can never drift out of sync with reality — `collapsed` is also mutated
// directly by clicking individual nodes, not just by this switch.
function renderToggleExpand(): void {
  const isFullyExpanded = collapsed.size === 0;
  toggleExpandBtn.setAttribute("aria-checked", String(isFullyExpanded));
  toggleExpandText.textContent = isFullyExpanded ? "Expanded all" : "Collapsed";
}

// Every action that can change `collapsed` (this switch, or clicking a node
// to expand/collapse it) must re-render the tree AND resync this switch —
// routed through one function so neither path can forget the other.
function renderTree(): void {
  treeRenderer.render();
  renderToggleExpand();
}
renderToggleExpand();

toggleExpandBtn.addEventListener("click", () => {
  showTree();
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
  showDetail,
  getHideUnused: () => hideUnused,
});

byId("zoomIn").addEventListener("click", () => {
  viewport.zoomStep(1.2);
});
byId("zoomOut").addEventListener("click", () => {
  viewport.zoomStep(1 / 1.2);
});

byId("fitView").addEventListener("click", () => {
  showTree();
  viewport.fitView(treeRenderer.getVisibleNodes());
});

const toggleUnusedBtn = byId<HTMLButtonElement>("toggleUnused");
const toggleUnusedText = byId("toggleUnusedText");
const toggleUnusedCaption = byId("toggleUnusedCaption");

const UNUSED_CAPTIONS: Record<"off" | "on", string> = {
  off: "Showing all barrel re-exports, including unused ones.",
  on: "Unused barrel re-exports are hidden.",
};

// The scan reports the edges it lost; with any of them missing, nothing was
// marked unused (a consumer it never read could be the one asking for the
// name), so the toggle has nothing to act on and would just look broken.
const unusedUnavailable = DATA.coverageGaps.length > 0;

function renderToggleUnused(): void {
  if (unusedUnavailable) {
    toggleUnusedBtn.disabled = true;
    toggleUnusedBtn.setAttribute("aria-checked", "false");
    toggleUnusedBtn.setAttribute(
      "aria-label",
      "Hiding unused re-exports is unavailable: the scan did not read every importing file",
    );
    toggleUnusedText.textContent = "All shown";
    toggleUnusedCaption.textContent =
      "Unavailable — the scan missed some imports, so an unrequested re-export can't be told apart from one it never read. See Warnings.";
    return;
  }
  // "checked" tracks the switch's highlighted look (All shown), not the raw
  // `hideUnused` flag — All shown is deliberately the highlighted/"on" state
  // (the more permissive option reads as "enabled"), so aria-checked must
  // agree with that, not with hideUnused directly, or a screen reader would
  // announce the opposite of what's rendered.
  toggleUnusedBtn.setAttribute("aria-checked", String(!hideUnused));
  toggleUnusedText.textContent = hideUnused ? "Unused hidden" : "All shown";
  toggleUnusedCaption.textContent = UNUSED_CAPTIONS[hideUnused ? "on" : "off"];
}
renderToggleUnused();

toggleUnusedBtn.addEventListener("click", () => {
  showTree();
  hideUnused = !hideUnused;
  renderToggleUnused();
  countDescendants(forest, hideUnused);
  renderTree();
  viewport.fitView(treeRenderer.getVisibleNodes());
});

createSearch({
  byId: nodeById,
  parentOf,
  searchInput: byId<HTMLInputElement>("search"),
  searchHint: byId("searchHint"),
  jumpTo: (id) => {
    showTree();
    nav.jumpTo(id);
  },
  getHideUnused: () => hideUnused,
});

renderTree();
requestAnimationFrame(() => {
  viewport.fitView(treeRenderer.getVisibleNodes());
});
