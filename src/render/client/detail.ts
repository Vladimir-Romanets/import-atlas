import type { ColorPair, RenderNode } from './types';
import { byId } from './dom';

export function showDetail(node: RenderNode, colorOf: (layer: string) => ColorPair): void {
  byId('detail').hidden = false;
  byId('dSwatch').style.background = colorOf(node.layer)[0];

  // Built from spans rather than assigned as one string: a name pulled only
  // as a type gets a `type ` prefix (TypeScript's own spelling for it) and
  // its neighbours don't, which textContent can't express in one go.
  const label = byId('dLabel');
  label.textContent = '';
  if (node.importedAs !== '*' && node.importedAs.length > 0) {
    node.importedAs.forEach((name, i) => {
      if (i > 0) label.appendChild(document.createTextNode(', '));
      const span = document.createElement('span');
      span.textContent = node.importedAsTypeOnly.includes(name) ? `type ${name}` : name;
      label.appendChild(span);
    });
  } else {
    label.textContent = node.label;
  }

  // relPath's own last segment already is node.label plus its extension, so
  // nothing here needs to name the file again.
  byId('dPath').textContent = node.relPath;
  byId('dNote').textContent = node.note ? `imports: ${node.note}` : '';
  byId('dWarn').textContent = node.warn ? `⚠ ${node.warn}` : '';
  byId('dHint').textContent = node.hint ? `💡 ${node.hint}` : '';
}
