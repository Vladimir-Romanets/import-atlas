export function byId<T extends Element = HTMLElement>(id: string): T {
  return document.getElementById(id) as unknown as T;
}
