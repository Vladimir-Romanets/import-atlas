import type { ColorPair } from "./types";

const PALETTE: ColorPair[] = [
  ["#B8A72E", "#E0D47B"],
  ["#B82E34", "#E07B7F"],
  ["#49B82E", "#8FE07B"],
  ["#B82EB3", "#E07BDD"],
  ["#2E9EB8", "#7BCDE0"],
  ["#7C2EB8", "#B57BE0"],
  ["#B8672E", "#E0A57B"],
  ["#2EB852", "#7BE095"],
  ["#3D2EB8", "#867BE0"],
  ["#2EB892", "#7BE0C4"],
  ["#2E5EB8", "#7B9EE0"],
  ["#B82E74", "#E07BAE"],
  ["#89B82E", "#BEE07B"],
];
const NEUTRAL: ColorPair = ["#6B7280", "#8D95A5"];

export function createColorScale(
  layers: string[],
): (layer: string) => ColorPair {
  const layerColor: Record<string, ColorPair> = {};
  layers.forEach((layer, i) => {
    layerColor[layer] =
      layer === "(root)" ? NEUTRAL : PALETTE[i % PALETTE.length];
  });
  return (layer) => layerColor[layer] || NEUTRAL;
}
