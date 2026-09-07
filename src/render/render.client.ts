import type { RenderData } from '../types';
import type { RenderNode } from './client/types';
import { byId } from './client/dom';
import { createColorScale } from './client/colors';
import { renderSidebar } from './client/sidebar';
import { buildIndex, countDescendants, createCollapsedState } from './client/tree';
import { createViewport } from './client/viewport';
import { showDetail } from './client/detail';
import { createTreeRenderer } from './client/svgTree';
import { createNavigation, type Navigation } from './client/navigation';
import { createSearch } from './client/search';

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

const { byId: nodeById, parentOf } = buildIndex(forest);
countDescendants(forest);
const { collapsed, defaultCollapse } = createCollapsedState(forest);

const svg = byId<SVGSVGElement>('canvas');
const viewportG = byId<SVGGElement>('viewport');
const edgesG = byId<SVGGElement>('edges');
const nodesG = byId<SVGGElement>('nodes');

const viewport = createViewport(svg, viewportG);

let nav: Navigation;
const treeRenderer = createTreeRenderer({
  forest,
  edgesG,
  nodesG,
  colorOf,
  collapsed,
  onActivate: (node) => nav.onNodeActivate(node)
});

nav = createNavigation({
  collapsed,
  byId: nodeById,
  parentOf,
  render: treeRenderer.render,
  svg,
  nodesG,
  viewport,
  showDetail
});

byId('zoomIn').addEventListener('click', () => { viewport.zoomStep(1.2); });
byId('zoomOut').addEventListener('click', () => { viewport.zoomStep(1/1.2); });

byId('expandAll').addEventListener('click', () => {
  collapsed.clear();
  treeRenderer.render();
  viewport.fitView(treeRenderer.getVisibleNodes());
});
byId('collapseDefault').addEventListener('click', () => {
  defaultCollapse();
  treeRenderer.render();
  viewport.fitView(treeRenderer.getVisibleNodes());
});
byId('fitView').addEventListener('click', () => {
  viewport.fitView(treeRenderer.getVisibleNodes());
});

createSearch({
  byId: nodeById,
  searchInput: byId<HTMLInputElement>('search'),
  searchHint: byId('searchHint'),
  jumpTo: nav.jumpTo
});

treeRenderer.render();
requestAnimationFrame(() => { viewport.fitView(treeRenderer.getVisibleNodes()); });
