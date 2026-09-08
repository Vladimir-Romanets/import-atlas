import type { RenderNode } from './types';
import { byId } from './dom';

export function showDetail(node: RenderNode): void {
  byId('detail').hidden = false;
  byId('dLabel').textContent = node.label;
  byId('dPath').textContent = node.relPath;
  byId('dNote').textContent = node.note && !node.ref ? `imports: ${node.note}` : (node.ref ? 'Re-used elsewhere — click jumps to its definition.' : '');
  byId('dWarn').textContent = node.warn ? `⚠ ${node.warn}` : '';
}
