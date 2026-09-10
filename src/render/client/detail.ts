import type { RenderNode } from './types';
import { byId } from './dom';

export function showDetail(node: RenderNode): void {
  const importedAs = node.importedAs !== '*' && node.importedAs.length > 0 ? node.importedAs.join(', ') : node.label;
  byId('detail').hidden = false;
  byId('dLabel').textContent = importedAs;
  byId('dPath').textContent = importedAs !== node.label ? `${node.label} — ${node.relPath}` : node.relPath;
  byId('dNote').textContent = node.note ? `imports: ${node.note}` : '';
  byId('dWarn').textContent = node.warn ? `⚠ ${node.warn}` : '';
  byId('dHint').textContent = node.hint ? `💡 ${node.hint}` : '';
}
