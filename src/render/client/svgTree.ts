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
  getHideUnused: () => boolean;
}

export function createTreeRenderer({
  forest,
  edgesG,
  nodesG,
  colorOf,
  collapsed,
  onActivate,
  getHideUnused,
}: TreeRendererOptions): TreeRenderer {
  let visibleNodes: RenderNode[] = [];
  let visibleEdges: [RenderNode, RenderNode][] = [];
  // Which node reads as "selected" — set explicitly on click/keyboard
  // activation rather than derived from `:focus-visible`, since browsers
  // deliberately suppress that ring for mouse-triggered focus (even a
  // programmatic `.focus()` call made from inside a click handler still
  // counts as mouse-modality) — so it would never show for a mouse click,
  // only for Tab-based keyboard focus. Persists across re-renders here,
  // in this closure, independent of whatever DOM element currently holds
  // it (that element gets destroyed and recreated on every render()).
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
    path.setAttribute("class", "edge");
    const col = colorOf(c.layer);
    path.style.setProperty("--dot-l", col[0]);
    path.style.setProperty("--dot-d", col[1]);
    edgesG.appendChild(path);
  };

  const renderNode = (node: RenderNode, index: number) => {
    const g = document.createElementNS(SVGNS, "g");
    const classes = ["node"];
    if (node.ref) classes.push("is-ref");
    if (node.depth === 0) classes.push("entry");
    if (node.renderId === activeId) classes.push("active");
    g.setAttribute("class", classes.join(" "));
    g.setAttribute("transform", `translate(${node.x},${node.y - NODE_H / 2})`);
    g.setAttribute("tabindex", "0");
    g.setAttribute("role", "button");
    g.dataset.id = node.renderId;

    // Import specifier used by the caller (e.g. 'Button'),
    // falling back to the filename for entry points or namespace/dynamic imports.
    const importedAs =
      node.importedAs !== "*" && node.importedAs.length > 0
        ? node.importedAs.join(", ")
        : node.label;
    const fileName = fileNameOf(node.relPath);
    const folder = node.label === "index" ? folderOf(node.relPath) : "";
    // Secondary label showing the actual filename (with extension).
    // Includes parent folder for index/barrel files to avoid ambiguity.
    const subText = folder ? `${folder}/${fileName}` : fileName;
    const fullLabel =
      importedAs !== node.label
        ? `${importedAs} (${node.label}) — ${node.relPath}`
        : `${node.label} — ${node.relPath}`;
    g.setAttribute(
      "aria-label",
      `${fullLabel}${node.note ? `. imports ${node.note}` : ""}`,
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

    // Safety net: even with shortLabel's width estimate, a label can still
    // run wider than the box (unusual fonts, estimate drift). Clip it to
    // the node's own bounds so it's cut off cleanly instead of spilling
    // into neighboring nodes/icons.
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
    // _count reflects visible descendants (accounting for hidden nodes).
    // Using children.length directly would show a toggle chevron even
    // if all children are filtered out.
    const hasVisibleChildren = node._count > 0;
    const showBadge =
      !node.ref && hasVisibleChildren && collapsed.has(node.renderId);
    const badgeWidth = showBadge ? 8 + String(node._count).length * 6.5 : 0;
    let glyphOffset =
      (node.ref || hasVisibleChildren ? 14 : 0) +
      (showBadge ? badgeWidth + 4 : 0);
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

    if (node.ref) {
      const r = document.createElementNS(SVGNS, "text");
      r.setAttribute("class", "ref-glyph");
      r.setAttribute("x", String(rightX));
      r.setAttribute("y", String(NODE_H / 2 + 4));
      r.setAttribute("text-anchor", "end");
      r.textContent = "↗";
      g.appendChild(r);
    } else if (hasVisibleChildren) {
      const chev = document.createElementNS(SVGNS, "text");
      chev.setAttribute("class", "chev");
      chev.setAttribute("x", String(rightX));
      chev.setAttribute("y", String(NODE_H / 2 + 3));
      chev.setAttribute("text-anchor", "end");
      chev.textContent = collapsed.has(node.renderId) ? "▸" : "▾";
      g.appendChild(chev);

      if (showBadge) {
        const bg = document.createElementNS(SVGNS, "g");
        bg.setAttribute("class", "count-badge");
        const brect = document.createElementNS(SVGNS, "rect");
        brect.setAttribute("x", String(rightX - 14 - badgeWidth));
        brect.setAttribute("y", String(NODE_H / 2 - 8));
        brect.setAttribute("width", String(badgeWidth));
        brect.setAttribute("height", "14.5");
        brect.setAttribute("rx", "8");
        bg.appendChild(brect);
        const btext = document.createElementNS(SVGNS, "text");
        btext.setAttribute("x", String(rightX - 14 - badgeWidth / 2));
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
      // Browsers don't consistently focus a clicked element just because it
      // has tabindex (Chrome mostly does, Firefox/Safari often don't) — so
      // relying on that to know what to re-focus after `render()` rebuilds
      // the DOM is unreliable. Focus it explicitly here instead, so
      // `render()`'s "restore whatever had focus" capture always has
      // something correct to find, on every browser, mouse or keyboard.
      g.focus();
      // A ref click navigates on to its canonical target (see
      // navigation.ts's jumpTo) — mark THAT as active, not the ref stub
      // itself, so the outline lands where the view (and pulse ring)
      // actually ends up.
      activeId = node.ref ?? node.renderId;
      onActivate(node);
    });
    g.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        activeId = node.ref ?? node.renderId;
        onActivate(node);
      }
    });

    nodesG.appendChild(g);
  };

  const render = () => {
    visibleNodes = [];
    visibleEdges = [];
    let nextY = 0;
    const hideUnused = getHideUnused();
    forest.forEach((root) => {
      nextY = buildLayout(
        root,
        nextY,
        visibleNodes,
        visibleEdges,
        collapsed,
        hideUnused,
      );
      nextY += ROW_H * 2.2;
    });

    // Rebuilding DOM destroys the focused element.
    // Preserve the focused node's renderId and restore focus after re-rendering.
    const activeEl = document.activeElement;
    const focusedId =
      activeEl instanceof SVGGElement && nodesG.contains(activeEl)
        ? activeEl.dataset.id
        : undefined;

    edgesG.innerHTML = "";
    nodesG.innerHTML = "";

    visibleEdges.forEach(renderEdge);
    visibleNodes.forEach((node, i) => renderNode(node, i));

    if (focusedId) {
      nodesG.querySelector<SVGGElement>(`[data-id="${focusedId}"]`)?.focus();
    }
  };

  return { render, getVisibleNodes: () => visibleNodes };
}
