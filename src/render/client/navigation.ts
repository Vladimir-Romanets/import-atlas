import { SVGNS, NODE_W, NODE_H } from './constants';
import { materializeChildren } from './expand';
import type { RenderNode } from './types';
import type { Viewport } from './viewport';

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
}

export function createNavigation({ collapsed, byId, parentOf, render, svg, nodesG, viewport, showDetail }: NavigationOptions): Navigation {
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
    // A node standing for an occurrence expanded elsewhere gets that
    // occurrence's children copied under it on first open, so it behaves
    // like any other node from then on. Jumping to the full expansion is
    // still offered, from the detail panel.
    if (materializeChildren(node, byId, parentOf)){
      // The click that fetched the children is also the click that opens
      // them. Falling through to the toggle below would close the node the
      // moment it gained something to show, costing a second click.
      collapsed.delete(node.renderId);
    } else if (node._count > 0){
      // `_count`, not `children.length`, is what svgTree.ts draws the
      // chevron/badge from — toggling `collapsed` on a node that shows
      // neither would be an invisible no-op click that still desyncs the
      // Expand all/Collapse switch.
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
