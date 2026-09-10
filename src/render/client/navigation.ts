import { SVGNS, NODE_W, NODE_H } from './constants';
import type { RenderNode } from './types';
import type { Viewport } from './viewport';
import { isVisible } from './visibility';

export interface Navigation {
  jumpTo: (id: string) => void;
  onNodeActivate: (node: RenderNode) => void;
  expandAncestors: (id: string) => void;
}

export interface NavigationOptions {
  collapsed: Set<string>;
  byId: Record<string, RenderNode>;
  parentOf: Record<string, string>;
  render: () => void;
  svg: SVGSVGElement;
  nodesG: SVGGElement;
  viewport: Viewport;
  showDetail: (node: RenderNode) => void;
  getHideUnused: () => boolean;
}

export function createNavigation({ collapsed, byId, parentOf, render, svg, nodesG, viewport, showDetail, getHideUnused }: NavigationOptions): Navigation {
  const { view, clamp, applyTransform } = viewport;

  const expandAncestors = (id: string) => {
    let cur = parentOf[id];
    while (cur){
      collapsed.delete(cur);
      cur = parentOf[cur];
    }
  };

  const jumpTo = (id: string) => {
    const node = byId[id];
    if (!node) return;
    // A ref's target can sit under an ancestor that "hide unused" prunes —
    // expanding collapse state doesn't reveal it, since that pruning ignores
    // collapse entirely. Jumping anyway would pan to a node that was never
    // laid out: stale x/y, no pulse ring, detail panel pointing off-screen.
    if (!isVisible(node, byId, parentOf, getHideUnused())) return;
    expandAncestors(id);
    render();
    const rect = svg.getBoundingClientRect();
    const k = clamp(view.k, 0.6, 1.2);
    view.k = k;
    view.x = rect.width/2 - (node.x+NODE_W/2)*k;
    view.y = rect.height/2 - node.y*k;
    applyTransform();
    showDetail(node);
    setTimeout(() => {
      const el = nodesG.querySelector(`[data-id="${id}"] .box`);
      if (!el) return;
      const ring = document.createElementNS(SVGNS,'rect');
      ring.setAttribute('class','pulse');
      ring.setAttribute('x','-3');
      ring.setAttribute('y','-3');
      ring.setAttribute('width', String(NODE_W+6));
      ring.setAttribute('height', String(NODE_H+6));
      ring.setAttribute('rx','8');
      el.parentNode!.appendChild(ring);
      setTimeout(() => { ring.remove(); }, 2400);
    }, 30);
  };

  const onNodeActivate = (node: RenderNode) => {
    showDetail(node);
    if (node.ref){
      jumpTo(node.ref);
      return;
    }
    // `_count` (computed by countDescendants with the current hide-unused
    // state already baked in) — not `children.length` — is what svgTree.ts
    // draws the chevron/badge from. A node whose only children are filtered
    // out shows neither, so toggling `collapsed` for it here would be an
    // invisible no-op click that still desyncs the Expand all/Collapse switch.
    if (node._count > 0){
      if (collapsed.has(node.renderId)) {
        collapsed.delete(node.renderId);
      } else {
        collapsed.add(node.renderId);
      }
    }
    // Always re-render, even for a leaf with nothing to expand/collapse —
    // svgTree.ts's `.active` class (which node reads as "selected") is only
    // ever painted during a render pass, so skipping it here would leave a
    // plain leaf click with no visible feedback at all.
    render();
  };

  return { jumpTo, onNodeActivate, expandAncestors };
}
