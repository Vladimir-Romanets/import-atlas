import { byId } from "../dom";
import type { ColorPair } from "../types";
import type { GraphIndex, LayoutNode } from "./types";

function nameList(paths: string[]): string {
  const shown = paths.slice(0, 4).join(", ");
  return paths.length > 4 ? `${shown}, +${paths.length - 4} more` : shown;
}

/**
 * The sidebar panel for a selected node. Where the tree's answers "what did
 * this importer ask for?", this answers what only the graph view can: who is
 * on the other end of the lines arriving here.
 */
export function showGraphDetail(
  node: LayoutNode,
  index: GraphIndex,
  colorOf: (layer: string) => ColorPair,
): void {
  const inEdges = index.inEdges[node.id] ?? [];
  const outEdges = index.outEdges[node.id] ?? [];

  byId("detail").hidden = false;
  byId("dSwatch").style.background = colorOf(node.layer)[0];
  byId("dLabel").textContent = node.label;
  byId("dPath").textContent = node.relPath;
  byId("dNote").textContent = node.note ? `imports: ${node.note}` : "";

  const onCycle = [...inEdges, ...outEdges].some((edge) => edge.isBackEdge);
  // `mergeableStatements`, not `statements`: the warning sends the reader to
  // the Findings tab, so it has to count what `dupe-import` counts.
  const duplicated = [...inEdges, ...outEdges].filter(
    (edge) => edge.mergeableStatements > 1,
  ).length;
  const warnings: string[] = [];
  if (onCycle) {
    warnings.push("on a circular import — see the Findings tab for the loop");
  }
  if (duplicated > 0) {
    warnings.push(
      `${duplicated} of its links use more than one import statement`,
    );
  }
  byId("dWarn").textContent =
    warnings.length > 0 ? `⚠ ${warnings.join("; ")}` : "";

  const importers = inEdges
    .filter((edge) => edge.from !== node.id)
    .map((edge) => index.nodeById[edge.from]?.relPath ?? edge.from);
  byId("dHint").textContent =
    importers.length > 0
      ? `imported by ${importers.length}: ${nameList(importers)}${importers.length > 4 ? " — click the badge to the left of the selected node to draw all of them." : ""}`
      : node.isEntry
        ? "entry point"
        : "";
}
