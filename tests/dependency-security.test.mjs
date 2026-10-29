import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { JSDOM } from "jsdom";

const mathRequire = createRequire(import.meta.resolve("@streamdown/math"));
const mermaidRequire = createRequire(
  createRequire(import.meta.resolve("@streamdown/mermaid")).resolve("mermaid"),
);
const katex = (await import(pathToFileURL(mathRequire.resolve("katex")).href))
  .default;
const createDOMPurify = (
  await import(pathToFileURL(mermaidRequire.resolve("dompurify")).href)
).default;

test("the actual Mermaid sanitizer is patched and removes executable HTML/SVG", () => {
  const dom = new JSDOM("");
  try {
    const purify = createDOMPurify(dom.window);
    assert.equal(purify.version, "3.4.17");
    for (const source of [
      '<img src=x onerror="alert(1)"><script>alert(1)</script>',
      '<svg><g onload="alert(1)"></g><a href="javascript:alert(1)">link</a></svg>',
    ]) {
      const node = dom.window.document.createElement("div");
      node.innerHTML = purify.sanitize(source);
      assert.equal(node.querySelector("script,[onerror],[onload]"), null);
      assert.equal(node.querySelector('a[href^="javascript:"]'), null);
    }
  } finally {
    dom.window.close();
  }
});

test("patched KaTeX ignores inherited trust and the actual Streamdown math plugin still renders", async () => {
  assert.equal(katex.version, "0.19.1");
  const original = Object.getOwnPropertyDescriptor(Object.prototype, "trust");
  try {
    Object.defineProperty(Object.prototype, "trust", {
      configurable: true,
      writable: true,
      value: true,
    });
    const html = katex.renderToString(
      String.raw`\href{javascript:alert(1)}{click}`,
      { throwOnError: false, strict: false },
    );
    assert.ok(
      !/href=["']javascript:/i.test(html),
      "an inherited trust flag must not enable a JS link",
    );
  } finally {
    if (original) Object.defineProperty(Object.prototype, "trust", original);
    else delete Object.prototype.trust;
  }
  const { math } = await import("@streamdown/math");
  const { unified } = await import(
    pathToFileURL(mathRequire.resolve("unified")).href
  );
  const remarkParse = (
    await import(pathToFileURL(mathRequire.resolve("remark-parse")).href)
  ).default;
  const remarkRehype = (
    await import(pathToFileURL(mathRequire.resolve("remark-rehype")).href)
  ).default;
  const processor = unified()
    .use(remarkParse)
    .use(...math.remarkPlugin)
    .use(remarkRehype)
    .use(...math.rehypePlugin);
  const tree = await processor.run(processor.parse("$$\nx^2 + y^2 = z^2\n$$"));
  assert.match(JSON.stringify(tree), /katex/);
  assert.match(JSON.stringify(tree), /math/);
  assert.ok(fs.existsSync(mathRequire.resolve(math.getStyles())));
});

test("patched application Zod rejects oversized bounded arrays before validating children", async () => {
  const { z } = await import("zod");
  let visits = 0;
  const schema = z
    .array(
      z.preprocess((value) => {
        visits++;
        return value;
      }, z.string()),
    )
    .max(100);
  const result = schema.safeParse(Array(2000).fill(null));
  assert.equal(result.success, false);
  assert.equal(
    visits,
    0,
    "a size limit must reject before allocating per-child issues",
  );
  assert.equal(result.error.issues.length, 1);
  assert.equal(result.error.issues[0].code, "too_big");
});
