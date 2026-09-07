import { NODE_W, NODE_H, DRAG_THRESHOLD } from './constants';
import type { RenderNode } from './types';

export interface Viewport {
  view: { x: number; y: number; k: number };
  clamp: (v: number, a: number, b: number) => number;
  applyTransform: () => void;
  zoomStep: (factor: number) => void;
  fitView: (visibleNodes: RenderNode[]) => void;
}

export function createViewport(svg: SVGSVGElement, viewportG: SVGGElement): Viewport {
  const view = { x: 36, y: 36, k: 1 };
  const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
  const applyTransform = () => {
    viewportG.setAttribute('transform', `translate(${view.x},${view.y}) scale(${view.k})`);
  };

  svg.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect = svg.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.12 : 1/1.12;
    const newK = clamp(view.k * factor, 0.15, 3);
    const wx = (mx - view.x) / view.k;
    const wy = (my - view.y) / view.k;
    view.k = newK;
    view.x = mx - wx*newK;
    view.y = my - wy*newK;
    applyTransform();
  }, { passive:false });

  let dragging = false;
  let dragStart: { x: number; y: number; vx: number; vy: number; id: number } | null = null;
  svg.addEventListener('pointerdown', (e) => {
    dragStart = { x:e.clientX, y:e.clientY, vx:view.x, vy:view.y, id:e.pointerId };
    dragging = false;
  });
  svg.addEventListener('pointermove', (e) => {
    if (!dragStart) return;
    const dx = e.clientX - dragStart.x;
    const dy = e.clientY - dragStart.y;
    if (!dragging && (Math.abs(dx)+Math.abs(dy)) > DRAG_THRESHOLD){
      dragging = true;
      svg.classList.add('dragging');
      svg.setPointerCapture(dragStart.id);
    }
    if (dragging){
      view.x = dragStart.vx + dx;
      view.y = dragStart.vy + dy;
      applyTransform();
    }
  });
  const endDrag = () => {
    if (dragging){
      svg.classList.remove('dragging');
      try {
        if (dragStart) svg.releasePointerCapture(dragStart.id);
      } catch (e) {}
    }
    dragging = false;
    dragStart = null;
  };
  svg.addEventListener('pointerup', endDrag);
  svg.addEventListener('pointercancel', endDrag);
  svg.addEventListener('pointerleave', () => { if (!dragging) dragStart = null; });

  const zoomStep = (factor: number) => {
    const rect = svg.getBoundingClientRect();
    const mx = rect.width/2;
    const my = rect.height/2;
    const newK = clamp(view.k*factor, 0.15, 3);
    const wx = (mx-view.x)/view.k;
    const wy = (my-view.y)/view.k;
    view.k = newK;
    view.x = mx-wx*newK;
    view.y = my-wy*newK;
    applyTransform();
  };

  const fitView = (visibleNodes: RenderNode[]) => {
    if (!visibleNodes.length) return;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    visibleNodes.forEach((n) => {
      minX = Math.min(minX,n.x);
      maxX = Math.max(maxX,n.x+NODE_W);
      minY = Math.min(minY,n.y-NODE_H/2);
      maxY = Math.max(maxY,n.y+NODE_H/2);
    });
    const rect = svg.getBoundingClientRect();
    const pad = 40;
    const k = clamp(Math.min((rect.width-pad*2)/(maxX-minX), (rect.height-pad*2)/(maxY-minY)), 0.15, 1.4);
    view.k = k;
    view.x = pad-minX*k;
    view.y = pad-minY*k;
    applyTransform();
  };

  return { view, clamp, applyTransform, zoomStep, fitView };
}
