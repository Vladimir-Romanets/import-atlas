import { describe, expect, it } from 'vitest';
import { stringifyDeep } from '../utils/stringifyDeep';

describe('stringifyDeep', () => {
  it('matches JSON.stringify byte-for-byte on ordinary values', () => {
    const values: unknown[] = [
      null,
      42,
      'hello "world"\nwith a tab\t',
      true,
      false,
      [],
      {},
      [1, 'two', null, false, [3, 4]],
      { a: 1, b: { c: [1, 2, { d: null }] }, e: 'x' },
      { withUndefined: undefined, kept: 1 },
      [undefined, 1, () => {}, Symbol('s'), 2],
      { fn: () => {}, sym: Symbol('s'), kept: 'yes' },
      { nested: { deeply: { still: { here: [1, 2, 3] } } } },
    ];

    for (const value of values) {
      expect(stringifyDeep(value)).toBe(JSON.stringify(value));
    }
  });

  it('drops undefined/function/symbol object keys, same as JSON.stringify', () => {
    const value = { a: 1, b: undefined, c: () => {}, d: Symbol('x'), e: 2 };
    expect(stringifyDeep(value)).toBe('{"a":1,"e":2}');
    expect(stringifyDeep(value)).toBe(JSON.stringify(value));
  });

  it('turns undefined/function/symbol array slots into null, same as JSON.stringify', () => {
    const value = [1, undefined, () => {}, Symbol('x'), 2];
    expect(stringifyDeep(value)).toBe('[1,null,null,null,2]');
    expect(stringifyDeep(value)).toBe(JSON.stringify(value));
  });

  it('handles a scalar at the top level', () => {
    expect(stringifyDeep(42)).toBe('42');
    expect(stringifyDeep('x')).toBe('"x"');
    expect(stringifyDeep(null)).toBe('null');
    expect(stringifyDeep(true)).toBe('true');
  });

  it('produces text JSON.parse can read back into an equivalent structure', () => {
    const value = { forest: [{ id: 1, children: [{ id: 2, children: [] }] }] };
    expect(JSON.parse(stringifyDeep(value))).toEqual(JSON.parse(JSON.stringify(value)));
  });

  it('does not overflow the call stack on nesting deep enough to break JSON.stringify', () => {
    // Comfortably past the boundary rather than just over it — the whole
    // point this function exists for.
    const depth = 20000;
    let deep: unknown = { leaf: true };
    for (let i = 0; i < depth; i++) deep = { child: deep };

    expect(() => JSON.stringify(deep)).toThrow(RangeError);

    let text = '';
    expect(() => {
      text = stringifyDeep(deep);
    }).not.toThrow();

    // And the result is genuine, structurally-correct JSON: walk back down
    // it and confirm the leaf is still there at the bottom.
    let parsed: any = JSON.parse(text);
    for (let i = 0; i < depth; i++) parsed = parsed.child;
    expect(parsed).toEqual({ leaf: true });
  });

  it('throws on a cycle, same as JSON.stringify', () => {
    const selfRef: any = { a: 1 };
    selfRef.self = selfRef;
    expect(() => JSON.stringify(selfRef)).toThrow(TypeError);
    expect(() => stringifyDeep(selfRef)).toThrow(/circular/i);

    const a: any = { name: 'a' };
    const b: any = { name: 'b', a };
    a.b = b;
    expect(() => stringifyDeep(a)).toThrow(/circular/i);

    const arr: any[] = [1];
    arr.push(arr);
    expect(() => stringifyDeep(arr)).toThrow(/circular/i);
  });

  it('writes a shared sub-object twice rather than calling it a cycle', () => {
    // Only an ancestor of the value being written is a cycle. The same
    // object reached twice down different branches is ordinary sharing,
    // and the render payload does it — so this must serialize, not throw.
    const shared = { id: 'shared', names: ['x'] };
    const value = { left: shared, right: shared, both: [shared, shared] };

    expect(stringifyDeep(value)).toBe(JSON.stringify(value));
  });

  it('keeps serializing after a sibling branch closes', () => {
    // Guards the delete-on-pop half of the ancestor set: if a closed frame
    // were left in it, the second `shared` below would read as a cycle.
    const shared = { deep: { deeper: [1, 2] } };
    const value = [shared, { other: 1 }, shared];

    expect(stringifyDeep(value)).toBe(JSON.stringify(value));
  });

  it('handles a deep array chain the same way', () => {
    const depth = 20000;
    let deep: unknown = 'bottom';
    for (let i = 0; i < depth; i++) deep = [deep];

    const text = stringifyDeep(deep);
    let parsed: any = JSON.parse(text);
    for (let i = 0; i < depth; i++) parsed = parsed[0];
    expect(parsed).toBe('bottom');
  });
});
