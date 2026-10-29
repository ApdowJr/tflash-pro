/*
MIT License

Copyright (c) 2025 Colin McDonnell

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/

// Backport of Zod a0ebf970f2d752e5f58527cd2942ff48be4f46bd (GHSA-mrhx-c7xc-m3w5).
// Preserve upstream check ordering, skipChecks and backward/encode semantics.
function sizeCaps(checks) {
  const caps = [];
  for (const check of checks ?? []) {
    const def = check._zod.def;
    if (!/_(length|size)$|_equals$/.test(def.check)) break;
    const max = def.maximum ?? def.length ?? def.size;
    if (max >= 0) caps.push([max, check]);
  }
  return caps;
}

export function capSize(inst, size, attachSchema) {
  const caps = sizeCaps(inst._zod.def.checks);
  if (!caps.length) return;
  const cap = Math.min(...caps.map(([max]) => max));
  const parse = inst._zod.parse;
  inst._zod.parse = (payload, ctx) => {
    const n = size(payload.value);
    if (n > cap && !ctx?.skipChecks && ctx?.direction !== "backward") {
      for (const [max, check] of sizeCaps(inst._zod.def.checks)) {
        if (n > max && check._zod.def.when(payload)) {
          const start = payload.issues.length;
          check._zod.check(payload);
          payload.issues[start].continue = false;
          attachSchema(payload.issues, start, inst);
          return payload;
        }
      }
    }
    return parse(payload, ctx);
  };
}

export function generateSizeGate(doc, schema, size, numericOperand) {
  for (const [max, check] of sizeCaps(schema._zod.def.checks)) {
    doc.write(
      `if (${size} > ${numericOperand(max, check._zod.def.check)}) return INVALID;`,
    );
  }
}
