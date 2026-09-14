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
   * Recompute what's visible, lay it out again, and draw. For anything that
   * changes the graph on screen — including the chevrons and badges this
   * renderer draws itself, so every route that touches `visibility` ends up
   * here and `onVisibilityChange` fires on all of them.
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
  colorOf: (layer: string) => ColorPair;
  viewport: Viewport;
  onSelect: (node: LayoutNode | null) => void;
  /**
   * Called after every refresh, for chrome outside the canvas that is
   * derived from `visibility` — the Collapsed/Expanded switch. Most of what
   * opens and closes nodes is the chevrons and badges drawn in here, which
   * the page outside has no way to observe.
   */
  onVisibilityChange: () => void;
}

/**
 * World units drawn beyond the edges of the viewport. Wide enough that a
 * short pan lands on something already there — the redraw below only fires
 * once the viewport leaves what was last drawn.
 */
const VIEW_MARGIN = 700;
/**
 * Below this zoom, nodes are drawn as bare coloured blocks. A label set in
 * 11px type is unreadable at 40% anyway, and dropping the text, badges and
 * clip paths cuts the element count per node by an order of magnitude —
 * which is exactly the zoom level at which a reader is looking at hundreds
 * of nodes at once.
 */
const DETAIL_ZOOM = 0.45;
/**
 * Screen-space breathing room demanded around a node the walk up to an
 * importer steps to. A node flush against the edge of the viewport is
 * technically on screen and of no use to read, so it counts as off screen
 * and earns a pan.
 */
const STEP_INSET = 48;

/**
 * What the number in the left-hand badge means, for the reader who has just
 * put the cursor on it. A bare count leaves two things unsaid: which
 * direction it counts — importers, not imports, which is the one thing this
 * view can say and a tree cannot — and that it is a control at all. Both
 * belong here, since the badge is where a reader first meets the idea.
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
 * The importer to step to when the reader clicks a node that is already
 * selected — the nearest one on the canvas.
 *
 * With several importers there is no single right answer, so this takes the
 * one whose edge is shortest: that is the line the eye is already following
 * back from the node, and the one that keeps the view from jumping across
 * the canvas. An importer closed away behind a collapsed node is no use to
 * walk to, and a file importing itself leads nowhere.
 *
 * @param laidOut every node in the current layout, on screen or not — the
 * set the reader can reach, rather than the smaller set the virtualised
 * draw happens to have put in the DOM. The nearest importer is regularly
 * just off the edge of the viewport, and stepping to it is the caller's job
 * to make visible.
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
 * Split out of the pan below because it is the half that can be wrong in a
 * way nothing would show: `y` is the node's centre line while `x` is its
 * left edge, so the box runs from `y - NODE_H / 2` to `y + NODE_H / 2` but
 * from `x` to `x + NODE_W`, and an answer half a node out is the difference
 * between a step that pans and one that leaves the reader looking at a
 * clipped box.
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
 * Draws the merged graph, and draws only the part of it that is on screen.
 *
 * Virtualisation is not an optimisation here, it is the feature working at
 * all: a few thousand files is an ordinary project and an ordinary project
 * is what this has to open. Laying every visible node out is cheap and
 * happens in full; putting one in the DOM is not, and happens only for
 * what the viewport can actually show.
 */
export function createGraphRenderer({
  index,
  visibility,
  svg,
  edgesG,
  nodesG,
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
   * Whether the selection was aimed at the node, rather than arrived at.
   * Search selects whatever it lands on, and a reader who has just been
   * carried to a file has not asked to leave it again — so the click that
   * walks up to an importer is offered only for a node the reader picked
   * out on the canvas.
   */
  let selectedByClick = false;

  let drawnRect: WorldRect | null = null;
  let drawnDetailed = true;

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
   * Pan — never zoom — until a node is on screen, and do nothing at all if
   * it already is. Only the walk up to an importer needs this: the nearest
   * importer is nearest among a node's importers, which in a wide graph can
   * still be a screenful away, and a step that lands off-canvas is
   * indistinguishable from a click that did nothing. Leaving the picture
   * alone when the target is already in view matters just as much — moving
   * it under a reader who can see where they are going is its own kind of
   * disorienting.
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
    if (highlight.selectedId !== null) {
      if (highlight.reached.has(key)) classes.push("edge-reached");
      else if (highlight.edges.has(key)) classes.push("edge-hl");
      else classes.push("edge-dim");
    }

    const path = document.createElementNS(SVGNS, "path");
    path.setAttribute("d", edgeShape(link));
    path.setAttribute("class", classes.join(" "));
    const col = colorOf(link.to.layer);
    path.style.setProperty("--dot-l", col[0]);
    path.style.setProperty("--dot-d", col[1]);
    edgesG.appendChild(path);
  };

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
    if (highlight.selectedId !== null && !highlight.nodes.has(node.id)) {
      classes.push("node-dim");
    }
    g.setAttribute("class", classes.join(" "));
    g.setAttribute("transform", `translate(${node.x},${node.y - NODE_H / 2})`);
    g.dataset.id = node.id;

    const col = colorOf(node.layer);
    const rect = document.createElementNS(SVGNS, "rect");
    rect.setAttribute("width", String(NODE_W));
    rect.setAttribute("height", String(NODE_H));
    rect.setAttribute("rx", "5");

    if (!detailed) {
      // Zoomed out: a coloured block carrying layer and position, nothing
      // that would be illegible anyway. No focus target either — tabbing
      // through hundreds of unlabelled blocks helps nobody.
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

    const marker = document.createElementNS(SVGNS, "path");
    marker.setAttribute("class", "marker");
    marker.style.setProperty("--dot-l", col[0]);
    marker.style.setProperty("--dot-d", col[1]);
    marker.setAttribute("d", "M 6,1 H 11 V 26 H 6 Q 1,26 1,21 V 6 Q 1,1 6,1 Z");
    g.appendChild(marker);

    // Numbered by draw order rather than by anything about the node: ids
    // have to be unique within the document, and only the nodes actually
    // drawn are in it.
    const clipId = `gclip-${seq}`;
    const clip = document.createElementNS(SVGNS, "clipPath");
    clip.setAttribute("id", clipId);
    const clipRect = document.createElementNS(SVGNS, "rect");
    clipRect.setAttribute("width", String(NODE_W));
    clipRect.setAttribute("height", String(NODE_H));
    clip.appendChild(clipRect);
    g.appendChild(clip);

    // The file's own name leads here, unlike the tree, where a node is one
    // importer's reach into a file and is named after what that importer
    // asked for. Merged, a node serves every importer at once, and the one
    // name they all agree on is the file's.
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

    // Left-hand badge: how many files import this one, and the control
    // that shows them. It sits where the incoming edges converge, which is
    // the whole story this view has to tell — a "12" there is a shared
    // module, and clicking it puts the twelve importers on screen.
    //
    // Symmetric with the chevron on the right, which opens what the node
    // imports. One node, both directions, neither of which a tree can show
    // from the same box.
    //
    // Drawn only while it has something to offer: an importer that isn't
    // on the canvas already. It stays through `showing` so that the same
    // control can put back what it brought in — which is also why the two
    // halves of the condition can't be folded into one.
    const showing = visibility.importersShown.has(node.id);
    const hidden = hiddenImporterCount(
      node.id,
      index,
      (id) => layoutById[id] !== undefined,
    );
    if (showing || hidden > 0) {
      const inG = document.createElementNS(SVGNS, "g");
      inG.setAttribute("class", showing ? "fan-in showing" : "fan-in");
      inG.setAttribute("tabindex", "0");
      inG.setAttribute("role", "button");
      // Its own tooltip, which takes precedence over the node's: hovering
      // the badge asks about the badge.
      const inTitle = document.createElementNS(SVGNS, "title");
      inTitle.textContent = importersTitle(node.fanIn, hidden, showing);
      inG.appendChild(inTitle);
      // Distinct from the node's own id so that keyboard focus lands back
      // on the badge, not the node behind it, after the redraw.
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
        // Without this the click also reaches the node behind the badge,
        // which would open its imports at the same time.
        e.stopPropagation();
        // The reader aimed at the badge, not at the node, so this does not
        // arm the walk upwards — the next click on the node body does.
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
      }
    }

    const title = document.createElementNS(SVGNS, "title");
    title.textContent = describe(node);
    g.appendChild(title);

    // Selecting opens, but never closes. Closing a node in a merged graph
    // is not the local act it is in a tree: what it was holding open can
    // be the only route to a whole region of the canvas, including
    // importers the reader asked for by name somewhere else entirely. A
    // click meant as "tell me about this one" would then take most of the
    // picture with it. So the destructive half lives on the chevron, where
    // it has to be aimed at.
    const activate = (): void => {
      // Whether this click has an opening to do: not "does the file import
      // anything" but "would opening it draw a box that isn't there" — the
      // files it imports may all be on screen already, reached from
      // somewhere else.
      const opens =
        !visibility.expanded.has(node.id) &&
        hiddenImportCount(node.id, index, (id) => layoutById[id] !== undefined) >
          0;

      // Clicking a node the reader has already clicked walks one step
      // backwards, to the file that imports it. It is the click that had
      // nothing left to do — the node is selected, and everything it
      // imports is drawn — and backwards is the direction this view
      // exists to travel, so
      // repeating it traces a file's way back to the entry point without
      // going near the sidebar.
      //
      // Two things come first. Opening: a node with imports still shut
      // answers the click the way any other node would. And an aimed
      // click: a file the reader searched for is selected on arrival, and
      // the click that follows is how they look at it, not how they leave.
      if (node.id === selected && selectedByClick && !opens) {
        const up = nearestImporter(node, index, layoutById);
        if (up !== undefined) {
          selectNode(up.id, true);
          onSelect(up);
          // Pan first, then draw: the pan decides which part of the canvas
          // the draw has to fill, and the node has to be in the DOM before
          // focus can land on it.
          bringIntoView(up);
          draw();
          // Selection moved, so the keyboard should move with it — and a
          // second Enter then steps up again.
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
      focused instanceof SVGGElement && nodesG.contains(focused)
        ? focused.dataset.id
        : undefined;

    edgesG.innerHTML = "";
    nodesG.innerHTML = "";

    for (const link of layout.edges) {
      // An edge is on screen when any part of the band between its two
      // ends is — a long edge whose both endpoints are off-screen can
      // still cross the middle of the view.
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

  // Panning and zooming redraw only when the viewport has left what was
  // last drawn, or crossed the zoom level where node detail appears — so a
  // drag across the margin costs nothing, and one across the canvas costs
  // one redraw per screenful rather than one per frame.
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

  // A window that grows uncovers canvas the last draw never filled: the
  // clip rect above is measured off the element, and nothing but a pan or
  // zoom asks for it again. Observing the element rather than the window
  // also catches the sidebar folding away and the page being zoomed. The
  // callback only queues a frame, and drawing does not resize the svg, so
  // it cannot set itself off again.
  new ResizeObserver(onViewportChange).observe(svg);

  return {
    refresh,
    draw,
    select: (id) => {
      // Selected from outside — the search, so far. Not an aimed click, so
      // the first click that follows belongs to the node the reader landed
      // on rather than to its importer.
      selectNode(id, false);
      draw();
    },
    selectedId: () => selected,
    laidOut: () => layout.nodes,
    nodeAt: (id) => layoutById[id],
  };
}
