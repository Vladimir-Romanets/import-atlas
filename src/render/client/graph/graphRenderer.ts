import { edgeKey } from "../../../utils/edgeKey";
import { NODE_H, NODE_W, SVGNS } from "../constants";
import { fileNameOf, folderOf, shortLabel } from "../layout";
import type { ColorPair } from "../types";
import type { Placed, Viewport } from "../viewport";
import { layoutGraph, type GraphLayout } from "./dagLayout";
import { computeHighlight, type Highlight } from "./highlight";
import type { GraphIndex, LayoutEdge, LayoutNode } from "./types";
import {
  hiddenImportCount,
  hiddenImporterCount,
  type Visibility,
} from "./visibility";

export interface GraphRenderer {
  /**
   * Recompute what's visible, lay it out again, and draw. Every route that
   * touches `visibility` — the chevrons and badges drawn here included —
   * goes through this, so `onVisibilityChange` fires on all of them.
   */
  refresh: () => void;
  /** Redraw the current layout. For anything that changes only what's *shown* of it — panning, zooming, selection. */
  draw: () => void;
  select: (id: string | null) => void;
  selectedId: () => string | null;
  /** Every node in the current layout, drawn or not — what "fit view" has to fit. */
  laidOut: () => LayoutNode[];
  nodeAt: (id: string) => LayoutNode | undefined;
}

export interface GraphRendererOptions {
  index: GraphIndex;
  visibility: Visibility;
  svg: SVGSVGElement;
  edgesG: SVGGElement;
  nodesG: SVGGElement;
  /** After `nodesG` in the DOM, so an edge moved here paints over every node. */
  edgesHoverG: SVGGElement;
  /** After `edgesHoverG`, so a badge moved here paints over a raised edge too. */
  nodesHoverG: SVGGElement;
  colorOf: (layer: string) => ColorPair;
  viewport: Viewport;
  onSelect: (node: LayoutNode | null) => void;
  /**
   * Called after every refresh, for chrome derived from `visibility` — the
   * Collapsed/Expanded switch. Most of what opens and closes nodes is the
   * chevrons and badges drawn here, which the page has no way to observe.
   */
  onVisibilityChange: () => void;
}

/**
 * World units drawn beyond the viewport, so a short pan lands on something
 * already there — the redraw below fires only once the viewport leaves what
 * was last drawn.
 */
const VIEW_MARGIN = 700;
/**
 * Below this zoom, nodes are bare coloured blocks: 11px type is unreadable
 * at 40% anyway, and dropping text, badges and clip paths cuts elements per
 * node by an order of magnitude — at exactly the zoom where hundreds of
 * nodes are on screen at once.
 */
const DETAIL_ZOOM = 0.45;
/**
 * Screen-space margin demanded around a node the walk up to an importer
 * steps to. A node flush against the viewport edge is of no use to read, so
 * it counts as off screen and earns a pan.
 */
const STEP_INSET = 48;

/**
 * Tooltip for the left-hand badge. A bare count leaves two things unsaid:
 * which direction it counts (importers, not imports — the one thing this
 * view can say and a tree cannot), and that it is a control at all.
 */
export function importersTitle(
  fanIn: number,
  hidden: number,
  showing: boolean,
): string {
  const subject =
    fanIn === 1 ? "1 file imports this one" : `${fanIn} files import this one`;
  if (showing) return `${subject} — click to put them away again`;
  const them = hidden === 1 ? "it" : "them";
  return hidden < fanIn
    ? `${subject}, ${hidden} of them not on screen — click to draw ${them}`
    : `${subject} — click to draw ${them}`;
}

/**
 * The importer to step to when the reader clicks an already-selected node:
 * the one whose edge is shortest — the line the eye is already following
 * back, and the one that keeps the view from jumping across the canvas. An
 * importer behind a collapsed node is no use, and a self-import leads
 * nowhere.
 *
 * @param laidOut every node in the current layout, on screen or not, rather
 * than the smaller set the virtualised draw put in the DOM. The nearest
 * importer is regularly just off-viewport; showing it is the caller's job.
 */
export function nearestImporter(
  node: LayoutNode,
  index: GraphIndex,
  laidOut: Record<string, LayoutNode>,
): LayoutNode | undefined {
  let best: LayoutNode | undefined;
  let bestDistance = Infinity;
  for (const edge of index.inEdges[node.id] ?? []) {
    if (edge.from === node.id) continue;
    const from = laidOut[edge.from];
    if (from === undefined) continue;
    const dx = node.x - from.x;
    const dy = node.y - from.y;
    const distance = dx * dx + dy * dy;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = from;
    }
  }
  return best;
}

export interface WorldRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * Whether a node's whole box lies inside a rectangle of the canvas.
 *
 * Split out of the pan below because it is the half that can be wrong
 * invisibly: `y` is the node's centre line while `x` is its left edge, so
 * the box runs `y ± NODE_H / 2` but `x` to `x + NODE_W`. Half a node out is
 * the difference between a step that pans and one that clips.
 */
export function fitsInView(node: Placed, view: WorldRect): boolean {
  return (
    node.x >= view.x0 &&
    node.x + NODE_W <= view.x1 &&
    node.y - NODE_H / 2 >= view.y0 &&
    node.y + NODE_H / 2 <= view.y1
  );
}

const covers = (outer: WorldRect, inner: WorldRect): boolean =>
  outer.x0 <= inner.x0 &&
  outer.y0 <= inner.y0 &&
  outer.x1 >= inner.x1 &&
  outer.y1 >= inner.y1;

/**
 * Draws the graph, and only the part of it that is on screen.
 *
 * Virtualisation is not an optimisation here but the feature working at
 * all: a few thousand files is an ordinary project. Laying every visible
 * node out is cheap and happens in full; putting one in the DOM is not, and
 * happens only for what the viewport can show.
 */
export function createGraphRenderer({
  index,
  visibility,
  svg,
  edgesG,
  nodesG,
  edgesHoverG,
  nodesHoverG,
  colorOf,
  viewport,
  onSelect,
  onVisibilityChange,
}: GraphRendererOptions): GraphRenderer {
  let layout: GraphLayout = { nodes: [], edges: [] };
  let layoutById: Record<string, LayoutNode> = {};
  let selected: string | null = null;
  let highlight: Highlight = computeHighlight(null, index);
  /**
   * Whether the selection was aimed at, rather than arrived at. Search
   * selects whatever it lands on, and a reader just carried to a file has
   * not asked to leave it — so the click that walks up to an importer is
   * offered only for a node picked out on the canvas.
   */
  let selectedByClick = false;

  let drawnRect: WorldRect | null = null;
  let drawnDetailed = true;

  /**
   * Drawn edges touching each node, in either direction, each paired with the
   * id at the far end. Rebuilt every draw, so `hoverNode` finds what to raise
   * without walking `layout.edges` on every pointer move.
   */
  let edgesByNode: Map<
    string,
    Array<{ path: SVGPathElement; otherId: string; dim: boolean }>
  > = new Map();
  /** Every detailed node's own `<g>`, keyed by id — no DOM query to raise one. */
  let nodeElementById: Map<string, SVGGElement> = new Map();
  /**
   * A node's `fan-in`/`chev-node`/`count-badge` children. Hover raises these
   * and never the box: a box lifted above a raised edge would clip the curves
   * that merely graze its column.
   */
  let badgesByNode: Map<string, SVGGElement[]> = new Map();
  /** The node whose edges are currently raised into `edgesHoverG`, if any. */
  let hoveredId: string | null = null;
  /** Nodes currently moved into `nodesHoverG` — the hovered node plus every neighbour a raised edge reaches. */
  let raisedNodeIds: Set<string> = new Set();
  /**
   * Edges now in `edgesHoverG`, each with the sibling it sat before, in the
   * order raised. `lowerAll` restores them in reverse, so an anchor that was
   * itself raised is already home — and the paint order survives the hover.
   */
  let raisedEdges: Array<{
    path: SVGPathElement;
    anchor: ChildNode | null;
  }> = [];

  const selectNode = (id: string | null, byClick: boolean): void => {
    selected = id;
    selectedByClick = byClick;
    highlight = computeHighlight(selected, index);
  };

  const viewRect = (margin: number): WorldRect => {
    const rect = svg.getBoundingClientRect();
    const { x, y, k } = viewport.view;
    return {
      x0: -x / k - margin,
      y0: -y / k - margin,
      x1: (rect.width - x) / k + margin,
      y1: (rect.height - y) / k + margin,
    };
  };

  /**
   * Pan — never zoom — until a node is on screen, and do nothing if it
   * already is. Only the walk up to an importer needs this: the nearest
   * importer can still be a screenful away, and a step landing off-canvas
   * is indistinguishable from a click that did nothing. Not moving the
   * picture when the target is already in view matters just as much.
   */
  const bringIntoView = (node: LayoutNode): void => {
    const rect = svg.getBoundingClientRect();
    const { k } = viewport.view;
    // In screen pixels, so the demand is the same at every zoom — and never
    // more than the viewport can grant.
    const inset = Math.min(STEP_INSET, rect.width / 4, rect.height / 4);
    if (fitsInView(node, viewRect(-inset / k))) return;

    viewport.view.x = rect.width / 2 - (node.x + NODE_W / 2) * k;
    viewport.view.y = rect.height / 2 - node.y * k;
    viewport.applyTransform();
  };

  // -----------------------------------------------------------------------
  // Edges
  // -----------------------------------------------------------------------
  const edgeShape = (link: LayoutEdge): string => {
    const { from, to } = link;
    if (from === to) {
      // A self-import: a loop off the node's right-hand side.
      const x = from.x + NODE_W;
      return `M ${x} ${from.y - 7} C ${x + 36} ${from.y - 24}, ${x + 36} ${from.y + 24}, ${x} ${from.y + 7}`;
    }
    if (link.edge.isBackEdge || to.x < from.x) {
      // Closes a cycle, so it is the one edge that runs right to left: out
      // of the source's left side, over the top, into the target's right.
      const sx = from.x;
      const tx = to.x + NODE_W;
      const lift = 30 + Math.abs(from.y - to.y) * 0.12;
      return `M ${sx} ${from.y} C ${sx - 70} ${from.y - lift}, ${tx + 70} ${to.y - lift}, ${tx} ${to.y}`;
    }
    const px = from.x + NODE_W;
    const cx = to.x;
    const dx = Math.max(26, (cx - px) * 0.45);
    return `M ${px} ${from.y} C ${px + dx} ${from.y}, ${cx - dx} ${to.y}, ${cx} ${to.y}`;
  };

  const renderEdge = (link: LayoutEdge): void => {
    const key = edgeKey(link.edge.from, link.edge.to);
    const classes = ["edge"];
    if (link.edge.isBackEdge) classes.push("edge-back");
    if (link.edge.isDeferred) classes.push("edge-deferred");
    // Dimmed by the selection, which asks a different question than hover, so
    // it sits out of the raise below.
    let dim = false;
    if (highlight.selectedId !== null) {
      if (highlight.reached.has(key)) classes.push("edge-reached");
      else if (highlight.edges.has(key)) classes.push("edge-hl");
      else {
        classes.push("edge-dim");
        dim = true;
      }
    }

    const path = document.createElementNS(SVGNS, "path");
    path.setAttribute("d", edgeShape(link));
    path.setAttribute("class", classes.join(" "));
    const col = colorOf(link.to.layer);
    path.style.setProperty("--dot-l", col[0]);
    path.style.setProperty("--dot-d", col[1]);
    edgesG.appendChild(path);

    const addTo = (id: string, otherId: string): void => {
      const list = edgesByNode.get(id);
      if (list === undefined) edgesByNode.set(id, [{ path, otherId, dim }]);
      else list.push({ path, otherId, dim });
    };
    addTo(link.edge.from, link.edge.to);
    // A self-import already got its one entry above — the loop's only node.
    if (link.edge.to !== link.edge.from) addTo(link.edge.to, link.edge.from);
  };

  // -----------------------------------------------------------------------
  // Hover: raise every edge touching a node, in either direction, above every
  // other node, so a reader can follow one file's fan-in or fan-out through a
  // dense crossing without clicking — which would also dim everything the
  // selection misses, a heavier answer to a lighter question. A node the
  // selection has already dimmed sits it out.
  //
  // A raised edge would cut across the badges at its own endpoints, so those
  // badges — the hovered node's and every raised neighbour's — go up into
  // `nodesHoverG` with it (not the whole node: see `badgesByNode`).
  // -----------------------------------------------------------------------

  /**
   * Set while focus is handed back after a move, so the `focusin` that fires
   * is not read as the keyboard arriving — on a neighbour's badge it would
   * hand the hover to the neighbour.
   */
  let restoringFocus = false;

  /**
   * Moving an element to another parent is a remove and an insert, which drops
   * focus. The badges raised below are focusable, so put focus back.
   */
  const keepingFocus = (move: () => void): void => {
    const focused = document.activeElement;
    move();
    if (
      focused instanceof SVGElement &&
      focused.isConnected &&
      document.activeElement !== focused
    ) {
      restoringFocus = true;
      focused.focus();
      restoringFocus = false;
    }
  };

  /** Returns everything the current hover raised to where the draw put it. */
  const lowerAll = (): void => {
    if (hoveredId === null) return;
    const id = hoveredId;
    hoveredId = null;
    nodeElementById.get(id)?.classList.remove("hovered");
    keepingFocus(() => {
      for (let i = raisedEdges.length - 1; i >= 0; i -= 1) {
        const { path, anchor } = raisedEdges[i];
        // A stale anchor would throw rather than misplace one line.
        edgesG.insertBefore(
          path,
          anchor !== null && anchor.parentNode === edgesG ? anchor : null,
        );
      }
      for (const nid of raisedNodeIds) {
        const parent = nodeElementById.get(nid);
        for (const el of badgesByNode.get(nid) ?? []) {
          el.removeAttribute("transform");
          parent?.appendChild(el);
        }
      }
    });
    raisedEdges = [];
    raisedNodeIds.clear();
  };

  let pendingLower = 0;
  const cancelPendingLower = (): void => {
    if (pendingLower === 0) return;
    cancelAnimationFrame(pendingLower);
    pendingLower = 0;
  };

  /**
   * Deferred a frame, and called off by any `hoverNode` that lands first: a
   * raised badge sits outside its node's `<g>`, so the pointer moving onto it
   * reads as leaving the node, and the badge's own enter arrives next.
   * Lowering at once would put the badge back under the pointer and the two
   * would trade places once a frame, forever.
   */
  const unhoverNode = (id: string): void => {
    if (hoveredId !== id) return;
    cancelPendingLower();
    pendingLower = requestAnimationFrame(() => {
      pendingLower = 0;
      lowerAll();
    });
  };

  const raiseNode = (id: string): void => {
    if (raisedNodeIds.has(id)) return;
    raisedNodeIds.add(id);
    const badges = badgesByNode.get(id);
    if (badges === undefined) return;
    const transform = nodeElementById.get(id)?.getAttribute("transform");
    // Out of `g` a badge carries no position of its own; with no transform to
    // copy it would land at the world origin, so leave it where it is.
    if (transform === null || transform === undefined) return;
    keepingFocus(() => {
      for (const el of badges) {
        el.setAttribute("transform", transform);
        nodesHoverG.appendChild(el);
      }
    });
  };

  const hoverNode = (node: LayoutNode, dimmed: boolean): void => {
    // Any enter calls off a pending lower — including the one fired by a badge
    // this same hover raised.
    cancelPendingLower();
    if (hoveredId === node.id) return;
    // Out of order pointerenter/pointerleave between adjacent nodes must
    // not leave the previous node's edges (and raised neighbours) stranded.
    lowerAll();
    if (dimmed) return;
    hoveredId = node.id;
    // Stands in for `:hover`, which the pointer stops satisfying once it rests
    // on a raised badge.
    nodeElementById.get(node.id)?.classList.add("hovered");
    // One insert instead of one per edge: a hub node touches hundreds.
    const batch = document.createDocumentFragment();
    // A dimmed edge sits out entirely: its own badge and its neighbour's
    // stay put, since nothing about to cover them is being raised.
    for (const { path, otherId, dim } of edgesByNode.get(node.id) ?? []) {
      if (dim) continue;
      // Read before the move, while the path is still among its siblings.
      raisedEdges.push({ path, anchor: path.nextSibling });
      batch.appendChild(path);
      raiseNode(node.id);
      raiseNode(otherId);
    }
    edgesHoverG.appendChild(batch);
  };

  // A redraw needs no hover code of its own: replacing the element under a
  // motionless pointer re-fires `pointerenter` in Chromium, Firefox and WebKit.

  // -----------------------------------------------------------------------
  // Nodes
  // -----------------------------------------------------------------------
  const describe = (node: LayoutNode): string => {
    const importers =
      node.fanIn === 1 ? "1 importer" : `${node.fanIn} importers`;
    const imports = node.fanOut === 1 ? "1 import" : `${node.fanOut} imports`;
    return `${node.label} — ${node.relPath}\n${importers}, ${imports}${node.note ? `\nimports: ${node.note}` : ""}`;
  };

  const renderNode = (
    node: LayoutNode,
    detailed: boolean,
    seq: number,
  ): void => {
    const g = document.createElementNS(SVGNS, "g");
    const classes = ["node"];
    if (node.isEntry) classes.push("entry");
    if (node.id === selected) classes.push("active");
    const dimmed =
      highlight.selectedId !== null && !highlight.nodes.has(node.id);
    if (dimmed) classes.push("node-dim");
    g.setAttribute("class", classes.join(" "));
    g.setAttribute("transform", `translate(${node.x},${node.y - NODE_H / 2})`);
    g.dataset.id = node.id;

    const col = colorOf(node.layer);
    const rect = document.createElementNS(SVGNS, "rect");
    rect.setAttribute("width", String(NODE_W));
    rect.setAttribute("height", String(NODE_H));
    rect.setAttribute("rx", "5");

    if (!detailed) {
      // Zoomed out: a coloured block carrying layer and position only. No
      // focus target either — tabbing through hundreds of unlabelled blocks
      // helps nobody — and no hover, the badges a raise keeps clear of not
      // being drawn at all.
      rect.setAttribute("class", "box box-far");
      rect.style.setProperty("--dot-l", col[0]);
      rect.style.setProperty("--dot-d", col[1]);
      g.appendChild(rect);
      nodesG.appendChild(g);
      return;
    }

    g.setAttribute("tabindex", "0");
    g.setAttribute("role", "button");
    g.setAttribute("aria-label", describe(node).replace(/\n/g, ". "));
    rect.setAttribute("class", "box");
    g.appendChild(rect);

    // Filled as the badges below are built — what hover raises, box aside.
    const badgeEls: SVGGElement[] = [];

    const marker = document.createElementNS(SVGNS, "path");
    marker.setAttribute("class", "marker");
    marker.style.setProperty("--dot-l", col[0]);
    marker.style.setProperty("--dot-d", col[1]);
    marker.setAttribute("d", "M 6,1 H 11 V 26 H 6 Q 1,26 1,21 V 6 Q 1,1 6,1 Z");
    g.appendChild(marker);

    // Numbered by draw order, not by node: ids only have to be unique
    // within the document, and only drawn nodes are in it.
    const clipId = `gclip-${seq}`;
    const clip = document.createElementNS(SVGNS, "clipPath");
    clip.setAttribute("id", clipId);
    const clipRect = document.createElementNS(SVGNS, "rect");
    clipRect.setAttribute("width", String(NODE_W));
    clipRect.setAttribute("height", String(NODE_H));
    clip.appendChild(clipRect);
    g.appendChild(clip);

    // The file's own name leads here, unlike the tree, where a node is
    // named after what one importer asked for. Here, a node serves every
    // importer at once, and the file's name is the one they all agree on.
    const fileName = fileNameOf(node.relPath);
    const folder = node.label === "index" ? folderOf(node.relPath) : "";
    const subText = folder ? `${folder}/${fileName}` : fileName;

    const text = document.createElementNS(SVGNS, "text");
    text.setAttribute("class", "label");
    text.setAttribute("clip-path", `url(#${clipId})`);
    text.setAttribute("x", "16");
    text.setAttribute("y", String(NODE_H / 2 - 1));
    const nameTspan = document.createElementNS(SVGNS, "tspan");
    nameTspan.setAttribute("x", "16");
    nameTspan.textContent = shortLabel(node.label);
    text.appendChild(nameTspan);
    const subTspan = document.createElementNS(SVGNS, "tspan");
    subTspan.setAttribute("class", "label-sub");
    subTspan.setAttribute("x", "16");
    subTspan.setAttribute("dy", "9");
    subTspan.textContent = shortLabel(subText);
    text.appendChild(subTspan);
    g.appendChild(text);

    // Left-hand badge: how many files import this one, and the control that
    // draws them. It sits where the incoming edges converge — a "12" there
    // is a shared module. Symmetric with the chevron on the right, which
    // opens what the node imports; a tree can show neither direction.
    //
    // Drawn only while it has something to offer (an importer not already
    // on the canvas), and kept through `showing` so the same control can
    // put back what it brought in — hence the two-part condition.
    const showing = visibility.importersShown.has(node.id);
    const hidden = hiddenImporterCount(
      node.id,
      index,
      (id) => layoutById[id] !== undefined,
    );
    if (showing || hidden > 0) {
      const inG = document.createElementNS(SVGNS, "g");
      const inClasses = ["fan-in"];
      if (showing) inClasses.push("showing");
      // The selection ring rides on the badge rather than being inherited from
      // `.node.active`: hover lifts the badge clean out of the node, where a
      // descendant selector can no longer reach it.
      if (node.id === selected) inClasses.push("on-active");
      inG.setAttribute("class", inClasses.join(" "));
      inG.setAttribute("tabindex", "0");
      inG.setAttribute("role", "button");
      // Takes precedence over the node's tooltip: hovering the badge asks
      // about the badge.
      const inTitle = document.createElementNS(SVGNS, "title");
      inTitle.textContent = importersTitle(node.fanIn, hidden, showing);
      inG.appendChild(inTitle);
      // Distinct from the node's own id, so focus lands back on the badge
      // rather than the node behind it after the redraw.
      inG.dataset.id = `${node.id}#importers`;
      inG.setAttribute(
        "aria-label",
        `${showing ? "Hide" : "Show"} the ${node.fanIn} file${node.fanIn === 1 ? "" : "s"} importing ${node.relPath}`,
      );
      const circle = document.createElementNS(SVGNS, "circle");
      circle.setAttribute("cx", "0");
      circle.setAttribute("cy", String(NODE_H / 2));
      circle.setAttribute("r", "8");
      inG.appendChild(circle);
      const count = document.createElementNS(SVGNS, "text");
      count.setAttribute("x", "0");
      count.setAttribute("y", String(NODE_H / 2 + 3));
      count.setAttribute("text-anchor", "middle");
      count.textContent = String(node.fanIn);
      inG.appendChild(count);

      const toggleImporters = (e: Event): void => {
        // Otherwise the click also reaches the node behind the badge and
        // opens its imports too.
        e.stopPropagation();
        // Aimed at the badge, not the node, so this does not arm the walk
        // upwards — the next click on the node body does.
        selectNode(node.id, false);
        onSelect(node);
        visibility.toggleImporters(node.id);
        refresh();
      };
      inG.addEventListener("click", toggleImporters);
      inG.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          toggleImporters(e);
        }
      });
      g.appendChild(inG);
      badgeEls.push(inG);
    }

    if (node.fanOut > 0) {
      const isOpen = visibility.expanded.has(node.id);
      const chevG = document.createElementNS(SVGNS, "g");
      chevG.setAttribute("class", "chev-node");
      chevG.setAttribute("tabindex", "0");
      chevG.setAttribute("role", "button");
      chevG.dataset.id = `${node.id}#imports`;
      chevG.setAttribute(
        "aria-label",
        `${isOpen ? "Hide" : "Show"} the ${node.fanOut} file${node.fanOut === 1 ? "" : "s"} imported by ${node.relPath}`,
      );
      const chevCircle = document.createElementNS(SVGNS, "circle");
      chevCircle.setAttribute("cx", String(NODE_W));
      chevCircle.setAttribute("cy", String(NODE_H / 2));
      chevCircle.setAttribute("r", "7");
      chevG.appendChild(chevCircle);
      const chev = document.createElementNS(SVGNS, "text");
      chev.setAttribute("class", "chev");
      chev.setAttribute("x", String(NODE_W));
      chev.setAttribute("y", String(NODE_H / 2 + 3));
      chev.setAttribute("text-anchor", "middle");
      chev.textContent = isOpen ? "▾" : "▸";
      chevG.appendChild(chev);

      const toggleImports = (e: Event): void => {
        e.stopPropagation();
        selectNode(node.id, false);
        onSelect(node);
        visibility.toggle(node.id);
        refresh();
      };
      chevG.addEventListener("click", toggleImports);
      chevG.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          toggleImports(e);
        }
      });
      g.appendChild(chevG);
      badgeEls.push(chevG);

      if (!isOpen) {
        const badgeWidth = 8 + String(node.fanOut).length * 6.5;
        const rightX = NODE_W - 10;
        const bg = document.createElementNS(SVGNS, "g");
        bg.setAttribute("class", "count-badge");
        const brect = document.createElementNS(SVGNS, "rect");
        brect.setAttribute("x", String(rightX - badgeWidth));
        brect.setAttribute("y", String(NODE_H / 2 - 8));
        brect.setAttribute("width", String(badgeWidth));
        brect.setAttribute("height", "14.5");
        brect.setAttribute("rx", "8");
        bg.appendChild(brect);
        const btext = document.createElementNS(SVGNS, "text");
        btext.setAttribute("x", String(rightX - badgeWidth / 2));
        btext.setAttribute("y", String(NODE_H / 2 + 2.5));
        btext.setAttribute("text-anchor", "middle");
        btext.textContent = String(node.fanOut);
        bg.appendChild(btext);
        g.appendChild(bg);
        badgeEls.push(bg);
      }
    }

    const title = document.createElementNS(SVGNS, "title");
    title.textContent = describe(node);
    g.appendChild(title);

    // Selecting opens, but never closes. Closing a node here is not the
    // local act it is in a tree: what it holds open can be the only route
    // to a whole region of the canvas, so a click meant as "tell me about
    // this one" would take most of the picture with it. The destructive
    // half lives on the chevron, where it has to be aimed at.
    const activate = (): void => {
      // Not "does the file import anything" but "would opening it draw a
      // box that isn't there" — its imports may all be on screen already,
      // reached from somewhere else.
      const opens =
        !visibility.expanded.has(node.id) &&
        hiddenImportCount(node.id, index, (id) => layoutById[id] !== undefined) >
          0;

      // Clicking an already-clicked node walks one step backwards, to the
      // file that imports it — the click that otherwise had nothing left
      // to do. Repeating it traces a file's way back to the entry point
      // without going near the sidebar.
      //
      // Two things come first. Opening: a node with imports still shut
      // answers the click like any other. And an aimed click: a searched-
      // for file is selected on arrival, and the next click is how the
      // reader looks at it, not how they leave.
      if (node.id === selected && selectedByClick && !opens) {
        const up = nearestImporter(node, index, layoutById);
        if (up !== undefined) {
          selectNode(up.id, true);
          onSelect(up);
          // Pan first, then draw: the pan decides what the draw has to
          // fill, and the node must be in the DOM before focus can land.
          bringIntoView(up);
          draw();
          // Selection moved, so the keyboard moves with it — a second
          // Enter then steps up again.
          nodesG
            .querySelector<SVGGElement>(`[data-id="${up.id}"]`)
            ?.focus();
          return;
        }
      }

      selectNode(node.id, true);
      onSelect(node);
      if (opens) {
        visibility.toggle(node.id);
        refresh();
      } else {
        draw();
      }
    };

    g.addEventListener("click", () => {
      g.focus();
      activate();
    });
    g.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        activate();
      }
    });
    // Focus raises what hover does: tabbing to a node is the keyboard pointing
    // at it, and the answer does not change with the input device.
    const enter = (): void => hoverNode(node, dimmed);
    const leave = (): void => unhoverNode(node.id);
    const focusEnter = (): void => {
      if (!restoringFocus) enter();
    };
    const focusLeave = (): void => {
      if (!restoringFocus) leave();
    };

    g.addEventListener("pointerenter", enter);
    g.addEventListener("pointerleave", leave);
    g.addEventListener("focusin", focusEnter);
    g.addEventListener("focusout", focusLeave);
    // A raised badge is no longer a child of `g`, so it carries the same pair
    // itself: otherwise the pointer crossing onto it reads as leaving the
    // node, and focus landing on it bubbles nowhere useful.
    for (const el of badgeEls) {
      el.addEventListener("pointerenter", enter);
      el.addEventListener("pointerleave", leave);
      el.addEventListener("focusin", focusEnter);
      el.addEventListener("focusout", focusLeave);
    }

    nodeElementById.set(node.id, g);
    if (badgeEls.length > 0) badgesByNode.set(node.id, badgeEls);
    nodesG.appendChild(g);
  };

  // -----------------------------------------------------------------------
  // Draw / refresh
  // -----------------------------------------------------------------------
  const draw = (): void => {
    const rect = viewRect(VIEW_MARGIN);
    const detailed = viewport.view.k >= DETAIL_ZOOM;

    const focused = document.activeElement;
    const focusedId =
      focused instanceof SVGGElement &&
      (nodesG.contains(focused) || nodesHoverG.contains(focused))
        ? focused.dataset.id
        : undefined;

    // Nothing survives the wipe below for a deferred lower to put back.
    cancelPendingLower();

    edgesG.innerHTML = "";
    nodesG.innerHTML = "";
    edgesHoverG.innerHTML = "";
    nodesHoverG.innerHTML = "";
    edgesByNode = new Map();
    nodeElementById = new Map();
    badgesByNode = new Map();
    hoveredId = null;
    raisedNodeIds = new Set();
    raisedEdges = [];

    for (const link of layout.edges) {
      // An edge is on screen when any part of the band between its ends
      // is: a long edge with both endpoints off-screen can still cross
      // the middle of the view.
      const x0 = Math.min(link.from.x, link.to.x);
      const x1 = Math.max(link.from.x, link.to.x) + NODE_W;
      const y0 = Math.min(link.from.y, link.to.y);
      const y1 = Math.max(link.from.y, link.to.y);
      if (x1 < rect.x0 || x0 > rect.x1 || y1 < rect.y0 || y0 > rect.y1)
        continue;
      renderEdge(link);
    }

    let seq = 0;
    for (const node of layout.nodes) {
      if (node.x + NODE_W < rect.x0 || node.x > rect.x1) continue;
      if (node.y + NODE_H < rect.y0 || node.y - NODE_H > rect.y1) continue;
      renderNode(node, detailed, seq++);
    }

    drawnRect = rect;
    drawnDetailed = detailed;

    if (focusedId !== undefined) {
      nodesG.querySelector<SVGGElement>(`[data-id="${focusedId}"]`)?.focus();
    }
  };

  const refresh = (): void => {
    const visible = visibility.compute();
    layout = layoutGraph(visible.nodes, visible.edges);
    layoutById = {};
    for (const node of layout.nodes) layoutById[node.id] = node;
    draw();
    onVisibilityChange();
  };

  // Redraw only once the viewport leaves what was last drawn, or crosses
  // DETAIL_ZOOM: a drag across the margin then costs nothing, and one
  // across the canvas costs a redraw per screenful, not per frame.
  let queued = false;
  const onViewportChange = (): void => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      const detailed = viewport.view.k >= DETAIL_ZOOM;
      if (
        drawnRect !== null &&
        detailed === drawnDetailed &&
        covers(drawnRect, viewRect(0))
      ) {
        return;
      }
      draw();
    });
  };
  viewport.onChange(onViewportChange);

  // A window that grows uncovers canvas the last draw never filled, and
  // only a pan or zoom would ask for it again. Observing the element rather
  // than the window also catches the sidebar folding away and page zoom.
  // Drawing does not resize the svg, so this cannot set itself off again.
  new ResizeObserver(onViewportChange).observe(svg);

  return {
    refresh,
    draw,
    select: (id) => {
      // Selected from outside (the search). Not an aimed click, so the
      // next click belongs to the node landed on, not to its importer.
      selectNode(id, false);
      draw();
    },
    selectedId: () => selected,
    laidOut: () => layout.nodes,
    nodeAt: (id) => layoutById[id],
  };
}
