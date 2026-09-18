import { SVGNS, ROW_H, NODE_W, NODE_H, LINE_GAP } from "./constants";
import { buildLayout, shortLabel, folderOf, fileNameOf } from "./layout";
import type { ColorPair, RenderNode } from "./types";

export interface TreeRenderer {
  render: () => void;
  getVisibleNodes: () => RenderNode[];
}

export interface TreeRendererOptions {
  forest: RenderNode[];
  edgesG: SVGGElement;
  nodesG: SVGGElement;
  colorOf: (layer: string) => ColorPair;
  collapsed: Set<string>;
  onActivate: (node: RenderNode) => void;
  /** The hovered (or focused) node's layer, or null once it's neither. Drives the sidebar legend. */
  onLayerHover: (layer: string | null) => void;
}

export function createTreeRenderer({
  forest,
  edgesG,
  nodesG,
  colorOf,
  collapsed,
  onActivate,
  onLayerHover,
}: TreeRendererOptions): TreeRenderer {
  let visibleNodes: RenderNode[] = [];
  let visibleEdges: [RenderNode, RenderNode][] = [];
  // Which node reads as "selected". Set explicitly on activation rather
  // than derived from `:focus-visible`, which browsers suppress for
  // mouse-triggered focus (a programmatic `.focus()` inside a click
  // handler included), so it would show only for Tab. Lives in this
  // closure, since render() destroys and recreates the element holding it.
  let activeId: string | null = null;

  const renderEdge = ([p, c]: [RenderNode, RenderNode]) => {
    const px = p.x + NODE_W;
    const py = p.y;
    const cx = c.x;
    const cy = c.y;
    const mid = Math.min(px + Math.max(24, (cx - px) / 2), cx - LINE_GAP);
    const d = `M ${px} ${py} H ${mid} V ${cy} H ${cx}`;
    const path = document.createElementNS(SVGNS, "path");
    path.setAttribute("d", d);
    // A tree node has one parent, so the edge into it is the one its own
    // `isDeferred` describes.
    path.setAttribute("class", c.isDeferred ? "edge edge-deferred" : "edge");
    const col = colorOf(c.layer);
    path.style.setProperty("--dot-l", col[0]);
    path.style.setProperty("--dot-d", col[1]);
    edgesG.appendChild(path);
  };

  const renderNode = (node: RenderNode, index: number) => {
    const g = document.createElementNS(SVGNS, "g");
    const classes = ["node"];
    if (node.depth === 0) classes.push("entry");
    if (node.renderId === activeId) classes.push("active");
    if (node.reachedOnlyByTypes) classes.push("type-only");
    g.setAttribute("class", classes.join(" "));
    g.setAttribute("transform", `translate(${node.x},${node.y - NODE_H / 2})`);
    g.setAttribute("tabindex", "0");
    g.setAttribute("role", "button");
    g.dataset.id = node.renderId;

    // The specifier the caller used ('Button'); '*' for an entry point or a
    // namespace/dynamic import, where the filename has to stand in.
    const importedAs =
      node.importedAs !== "*" && node.importedAs.length > 0
        ? node.importedAs.join(", ")
        : node.label;
    const fileName = fileNameOf(node.relPath);
    const folder = node.label === "index" ? folderOf(node.relPath) : "";
    // Secondary label: the filename with its extension, prefixed by the
    // parent folder for index/barrel files, which are otherwise ambiguous.
    const subText = folder ? `${folder}/${fileName}` : fileName;
    const fullLabel =
      importedAs !== node.label
        ? `${importedAs} (${node.label}) — ${node.relPath}`
        : `${node.label} — ${node.relPath}`;
    // A screen reader should hear what the detail panel shows — the type
    // prefix — even though the visible label itself never gets one.
    const importedAsSpoken =
      node.importedAs !== "*" && node.importedAs.length > 0
        ? node.importedAs
            .map((name) => (node.importedAsTypeOnly.includes(name) ? `type ${name}` : name))
            .join(", ")
        : node.label;
    const fullLabelSpoken =
      importedAs !== node.label
        ? `${importedAsSpoken} (${node.label}) — ${node.relPath}`
        : `${importedAsSpoken} — ${node.relPath}`;
    // The dashed border says this on screen; spell it out for a reader who
    // gets no border.
    const spokenTypeOnly = node.reachedOnlyByTypes
      ? ". reached only as a type"
      : "";
    g.setAttribute(
      "aria-label",
      `${fullLabelSpoken}${spokenTypeOnly}${node.note ? `. imports ${node.note}` : ""}`,
    );

    const rect = document.createElementNS(SVGNS, "rect");
    rect.setAttribute("class", "box");
    rect.setAttribute("width", String(NODE_W));
    rect.setAttribute("height", String(NODE_H));
    rect.setAttribute("rx", "5");
    g.appendChild(rect);

    const col = colorOf(node.layer);
    const marker = document.createElementNS(SVGNS, "path");
    marker.setAttribute("class", "marker");
    marker.style.setProperty("--dot-l", col[0]);
    marker.style.setProperty("--dot-d", col[1]);
    marker.setAttribute("d", "M 6,1 H 11 V 26 H 6 Q 1,26 1,21 V 6 Q 1,1 6,1 Z");
    g.appendChild(marker);

    // Safety net: despite shortLabel's width estimate, a label can still
    // run wider than the box (unusual fonts, estimate drift). Clipping to
    // the node's bounds cuts it off instead of spilling into neighbours.
    const clipId = `label-clip-${index}`;
    const clip = document.createElementNS(SVGNS, "clipPath");
    clip.setAttribute("id", clipId);
    const clipRect = document.createElementNS(SVGNS, "rect");
    clipRect.setAttribute("width", String(NODE_W));
    clipRect.setAttribute("height", String(NODE_H));
    clip.appendChild(clipRect);
    g.appendChild(clip);

    const text = document.createElementNS(SVGNS, "text");
    text.setAttribute("class", "label");
    text.setAttribute("clip-path", `url(#${clipId})`);
    text.setAttribute("x", "16");
    if (subText) {
      text.setAttribute("y", String(NODE_H / 2 - 1));
      const nameTspan = document.createElementNS(SVGNS, "tspan");
      nameTspan.setAttribute("x", "16");
      nameTspan.textContent = shortLabel(importedAs);
      text.appendChild(nameTspan);
      const subTspan = document.createElementNS(SVGNS, "tspan");
      subTspan.setAttribute("class", "label-sub");
      subTspan.setAttribute("x", "16");
      subTspan.setAttribute("dy", "9");
      subTspan.textContent = shortLabel(subText);
      text.appendChild(subTspan);
    } else {
      text.setAttribute("y", String(NODE_H / 2 + 4));
      text.textContent = shortLabel(importedAs);
    }
    g.appendChild(text);

    const rightX = NODE_W - 10;
    const hasVisibleChildren = node._count > 0;
    // Mirrors buildLayout's test: a node reads as open only with children
    // laid out beneath it, which an unopened reference has none of.
    const isOpen = node.children.length > 0 && !collapsed.has(node.renderId);
    const showBadge = hasVisibleChildren && !isOpen;
    const badgeWidth = showBadge ? 8 + String(node._count).length * 6.5 : 0;
    let glyphOffset = showBadge ? badgeWidth + 4 : 0;

    if (node.warn) {
      const w = document.createElementNS(SVGNS, "text");
      w.setAttribute("class", "warn-glyph");
      w.setAttribute("x", String(rightX - glyphOffset));
      w.setAttribute("y", String(NODE_H / 2 + 4));
      w.setAttribute("text-anchor", "end");
      w.textContent = "⚠";
      g.appendChild(w);
      glyphOffset += 14;
    }

    if (node.hint) {
      const h = document.createElementNS(SVGNS, "text");
      h.setAttribute("class", "hint-glyph");
      h.setAttribute("x", String(rightX - glyphOffset));
      h.setAttribute("y", String(NODE_H / 2 + 4));
      h.setAttribute("text-anchor", "end");
      h.textContent = "💡";
      g.appendChild(h);
      glyphOffset += 14;
    }

    if (hasVisibleChildren) {
      const chevG = document.createElementNS(SVGNS, "g");
      chevG.setAttribute("class", "chev-node");
      const chevCircle = document.createElementNS(SVGNS, "circle");
      chevCircle.setAttribute("cx", String(NODE_W));
      chevCircle.setAttribute("cy", String(NODE_H / 2));
      chevCircle.setAttribute("r", "7");
      chevG.appendChild(chevCircle);
      const chev = document.createElementNS(SVGNS, "text");
      chev.setAttribute("class", "chev");
      chev.setAttribute("x", String(NODE_W + (isOpen ? 0 : 0.5)));
      chev.setAttribute("y", String(NODE_H / 2 + 3));
      chev.setAttribute("text-anchor", "middle");
      chev.textContent = isOpen ? "▾" : "▸";
      chevG.appendChild(chev);
      g.appendChild(chevG);

      if (showBadge) {
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
        btext.textContent = String(node._count);
        bg.appendChild(btext);
        g.appendChild(bg);
      }
    }

    const title = document.createElementNS(SVGNS, "title");
    title.textContent = `${fullLabel}${node.note ? `\nimports: ${node.note}` : ""}${node.warn ? `\n⚠ ${node.warn}` : ""}${node.hint ? `\n💡 ${node.hint}` : ""}${node.fanIn > 1 ? `\nfan-in: ${node.fanIn}` : ""}`;
    g.appendChild(title);

    g.addEventListener("click", () => {
      // Browsers don't consistently focus a clicked element just for
      // having tabindex (Chrome mostly does, Firefox/Safari often don't).
      // Focusing explicitly gives `render()`'s "restore whatever had
      // focus" something correct to find, on every browser.
      g.focus();
      activeId = node.renderId;
      onActivate(node);
    });
    g.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        activeId = node.renderId;
        onActivate(node);
      }
    });
    const layerEnter = (): void => onLayerHover(node.layer);
    const layerLeave = (): void => onLayerHover(null);
    g.addEventListener("pointerenter", layerEnter);
    g.addEventListener("pointerleave", layerLeave);
    g.addEventListener("focusin", layerEnter);
    g.addEventListener("focusout", layerLeave);

    nodesG.appendChild(g);
  };

  const render = () => {
    visibleNodes = [];
    visibleEdges = [];
    let nextY = 0;
    forest.forEach((root) => {
      nextY = buildLayout(root, nextY, visibleNodes, visibleEdges, collapsed);
      nextY += ROW_H * 2.2;
    });

    // Rebuilding the DOM destroys the focused element, so its renderId is
    // kept here and focus restored below.
    const activeEl = document.activeElement;
    const focusedId =
      activeEl instanceof SVGGElement && nodesG.contains(activeEl)
        ? activeEl.dataset.id
        : undefined;

    edgesG.innerHTML = "";
    nodesG.innerHTML = "";
    // Wiped with the DOM below, since a destroyed node fires no pointerleave
    // of its own. A motionless pointer's own re-entry (Chromium, Firefox and
    // WebKit all fire it) restores this right after, if it's still due.
    onLayerHover(null);

    visibleEdges.forEach(renderEdge);
    visibleNodes.forEach((node, i) => renderNode(node, i));

    if (focusedId) {
      nodesG.querySelector<SVGGElement>(`[data-id="${focusedId}"]`)?.focus();
    }
  };

  return { render, getVisibleNodes: () => visibleNodes };
}
