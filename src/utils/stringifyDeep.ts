/**
 * Behaves like `JSON.stringify(value)` — no replacer, no indentation — but
 * never recurses over the object/array nesting. `reportPage.ts` embeds the
 * whole render payload this way, and that payload can nest thousands of
 * levels deep on a project with a long import chain — a depth the
 * native `JSON.stringify` cannot walk
 * without exhausting the call stack, even though `JSON.parse` (and so the
 * browser reading the result back) walks it iteratively without
 * complaint.
 *
 * Nesting is walked with an explicit stack of frames, one per open
 * object/array; formatting a single scalar — string escaping, number/
 * boolean/null text — is still delegated to the native `JSON.stringify`,
 * since that call is one frame deep whatever the scalar's own size.
 *
 * Matches `JSON.stringify`'s handling of values a JSON document can't
 * represent: an object drops a key whose value is `undefined`, a function,
 * or a symbol; an array turns the same values into `null` instead of
 * dropping the slot. A cycle throws a `TypeError`, as it does natively.
 * `toJSON()` methods, replacer functions and indentation are not
 * supported — nothing under `RenderData`/`GraphRenderData` needs them.
 */
export function stringifyDeep(root: unknown): string {
  // A scalar (or null) at the top level needs no stack at all.
  if (root === null || typeof root !== "object") {
    return JSON.stringify(root) ?? "null";
  }

  type Frame =
    | { kind: "array"; value: unknown[]; index: number }
    | {
        kind: "object";
        value: Record<string, unknown>;
        keys: string[];
        index: number;
        wrote: boolean;
      };

  const out: string[] = [];
  const stack: Frame[] = [];

  // The objects whose frames are currently open, kept in step with `stack`
  // — the ancestors of the value being written, and nothing else. A value
  // that is its own ancestor is a cycle and cannot be serialized; one that
  // merely appears twice in different branches is fine, and `JSON.stringify`
  // writes it out twice. Anything coarser than "ancestors" (a set of every
  // object ever seen, say) would reject the second kind too, and the render
  // payload does share sub-objects between branches.
  const openObjects = new Set<object>();

  function frameFor(value: object): Frame {
    if (Array.isArray(value)) return { kind: "array", value, index: 0 };
    return {
      kind: "object",
      value: value as Record<string, unknown>,
      keys: Object.keys(value),
      index: 0,
      wrote: false,
    };
  }

  // Opens a nested object/array (pushing a frame for the loop below to
  // resume later) or, for a scalar, writes its full text in one native
  // call and returns it — nothing further to descend into.
  function open(value: unknown): string | undefined {
    if (value !== null && typeof value === "object") {
      if (openObjects.has(value)) {
        throw new TypeError("Converting circular structure to JSON");
      }
      out.push(Array.isArray(value) ? "[" : "{");
      stack.push(frameFor(value));
      openObjects.add(value);
      return undefined;
    }
    // undefined/function/symbol here means an array slot — an object key
    // with one of those values is filtered out before `open` is ever
    // called for it. JSON.stringify turns such an array slot into `null`.
    const text = JSON.stringify(value);
    const scalar = text === undefined ? "null" : text;
    out.push(scalar);
    return scalar;
  }

  open(root);

  while (stack.length > 0) {
    const frame = stack[stack.length - 1];

    if (frame.kind === "array") {
      if (frame.index >= frame.value.length) {
        out.push("]");
        stack.pop();
        openObjects.delete(frame.value);
        continue;
      }
      if (frame.index > 0) out.push(",");
      open(frame.value[frame.index++]);
      continue;
    }

    // Object: skip keys JSON.stringify itself would drop, rather than
    // emitting them and pruning after — an object with only such keys
    // must close with "{}", not a dangling comma.
    let descended = false;
    while (frame.index < frame.keys.length) {
      const key = frame.keys[frame.index++];
      const value = frame.value[key];
      if (
        value === undefined ||
        typeof value === "function" ||
        typeof value === "symbol"
      ) {
        continue;
      }
      if (frame.wrote) out.push(",");
      out.push(`${JSON.stringify(key)}:`);
      frame.wrote = true;
      open(value);
      descended = true;
      break;
    }
    if (!descended && frame.index >= frame.keys.length) {
      out.push("}");
      stack.pop();
      openObjects.delete(frame.value);
    }
  }

  return out.join("");
}
