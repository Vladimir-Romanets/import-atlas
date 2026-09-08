import type { ColorPair } from './types';

const PALETTE: ColorPair[] = [
  ['#B8842E','#D9A44E'], ['#2A8C82','#3FB3A8'], ['#4A5FD6','#8B98F5'],
  ['#C4532E','#E37A54'], ['#7A4FC9','#A98CF0'], ['#5E7A33','#8FB35C'],
  ['#2F7FB8','#5FA8E0'], ['#B04384','#E077B5']
];
const NEUTRAL: ColorPair = ['#6B7280','#8D95A5'];

export function createColorScale(layers: string[]): (layer: string) => ColorPair {
  const layerColor: Record<string, ColorPair> = {};
  layers.forEach((layer, i) => {
    layerColor[layer] = layer === '(root)' ? NEUTRAL : PALETTE[i % PALETTE.length];
  });
  return (layer) => layerColor[layer] || NEUTRAL;
}
