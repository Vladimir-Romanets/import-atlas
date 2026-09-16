import { byId } from './dom';

/**
 * The Canvas/Findings tab pair, which both viewers get from the shared
 * skeleton in `render.html`. The ids are fixed there rather than passed in:
 * one markup, one set of ids, so there is nothing per-viewer to configure.
 */
export interface Tabs {
  /**
   * Switches to the canvas panel. Every viewport operation measures the SVG
   * to know where to pan or zoom, and a hidden panel measures 0×0 — which
   * parks the view at a nonsense transform. The sidebar's canvas controls
   * stay clickable under the Findings tab, so they come through here first
   * rather than being disabled.
   */
  showCanvas(): void;
}

export function createTabs(): Tabs {
  const tabCanvas = byId<HTMLButtonElement>('tabCanvas');
  const tabFindings = byId<HTMLButtonElement>('tabFindings');
  const panelCanvas = byId('panelCanvas');
  const panelFindings = byId('panelFindings');

  function activate(canvas: boolean): void {
    tabCanvas.setAttribute('aria-selected', String(canvas));
    tabFindings.setAttribute('aria-selected', String(!canvas));
    panelCanvas.hidden = !canvas;
    panelFindings.hidden = canvas;
  }

  tabCanvas.addEventListener('click', () => {
    activate(true);
  });
  tabFindings.addEventListener('click', () => {
    activate(false);
  });

  // Findings is never opened programmatically — only by its own tab — so it
  // is deliberately not part of the returned interface.
  return {
    showCanvas: () => {
      activate(true);
    },
  };
}
