/**
 * `JSON.stringify(value)` — no replacer, no indentation — without recursing
 * over the nesting. `reportPage.ts` embeds the render payload this way, and
 * a long import chain nests it thousands of levels deep: further than the
 * native `JSON.stringify` can walk without exhausting the call stack, even
 * though `JSON.parse` reads the result back iteratively without complaint.
 *
 * Nesting is walked with an explicit stack, one frame per open
 * object/array; formatting a scalar is still left to the native
 * `JSON.stringify`, one frame deep whatever the scalar's size.
 *
 * Matches `JSON.stringify` on values JSON can't represent: an object drops
 * a key whose value is `undefined`, a function or a symbol; an array turns
 * the same into `null`. A cycle throws a `TypeError`, as natively.
 * `toJSON()`, replacers and indentation are unsupported — nothing under
 * `RenderData`/`GraphRenderData` needs them.
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

  // Ancestors of the value being written — the objects whose frames are
  // open, kept in step with `stack`. A value that is its own ancestor is a
  // cycle; one merely appearing twice in different branches is fine, and
  // `JSON.stringify` writes it out twice. Anything coarser (every object
  // ever seen, say) would reject the second kind, which the render payload
  // relies on.
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

  // Opens a nested object/array, pushing a frame for the loop below to
  // resume; or, for a scalar, writes its text in one native call and
  // returns it — nothing to descend into.
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
    // undefined/function/symbol here means an array slot — such an object
    // key is filtered out before `open` sees it. JSON.stringify turns
    // these slots into `null`.
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

    // Skip keys JSON.stringify would drop rather than emit and prune after
    // — an object of only such keys must close as "{}", not on a comma.
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
