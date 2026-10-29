import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  copyFile,
  writeFile,
  readFile,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as fixed from "zod";
import * as bundled from "../node_modules/eve/dist/src/compiled/zod/index.js";
import {
  auditBundledZod,
  verifyBackport,
} from "../scripts/audit-bundled-zod.mjs";

const output = (result) =>
  result.success ? { data: result.data } : { issues: result.error.issues };
const inputFor = (kind) =>
  kind === "array"
    ? ["a", "b", "c"]
    : kind === "map"
      ? new Map([
          ["a", "a"],
          ["b", "b"],
          ["c", "c"],
        ])
      : new Set(["a", "b", "c"]);
const schemaFor = (z, kind, child) =>
  kind === "array"
    ? z.array(child)
    : kind === "map"
      ? z.map(child, child)
      : z.set(child);

test(
  "the installed shared Eve runtime passes exact-patch integrity and all behavior gates",
  auditBundledZod,
);

test("the gate rejects missing, altered and unknown backports without touching node_modules", async () => {
  const temp = await mkdtemp(path.join(tmpdir(), "tflash-zod-integrity-"));
  const root = pathToFileURL(`${temp}/`);
  const record = JSON.parse(
    await readFile(
      new URL("../patches/eve-zod-backport.json", import.meta.url),
      "utf8",
    ),
  );
  try {
    await writeFile(
      new URL("package.json", root),
      JSON.stringify({ name: "eve", version: "0.83.2" }),
    );
    for (const file of Object.keys(record.files)) {
      await mkdir(path.dirname(path.join(temp, file)), { recursive: true });
      await copyFile(
        new URL(`../node_modules/eve/${file}`, import.meta.url),
        new URL(file, root),
      );
    }
    await verifyBackport(root, "4.5.4");
    await assert.rejects(verifyBackport(root, "4.5.5"), /Unknown/);
    const helper = Object.keys(record.files).find((file) =>
      file.includes("tflash-zod-size-guard"),
    );
    const original = await readFile(new URL(helper, root));
    await rm(new URL(helper, root));
    await assert.rejects(verifyBackport(root, "4.5.4"), /ENOENT/);
    await writeFile(
      new URL(helper, root),
      Buffer.concat([original, Buffer.from("\n// changed")]),
    );
    await assert.rejects(verifyBackport(root, "4.5.4"), /integrity mismatch/);
    await writeFile(new URL(helper, root), original);
    const chunk = Object.keys(record.files).find(
      (file) => !file.includes("tflash-zod-size-guard"),
    );
    await writeFile(new URL(chunk, root), "// unpatched or altered runtime");
    await assert.rejects(verifyBackport(root, "4.5.4"), /integrity mismatch/);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

for (const kind of ["array", "map", "set"]) {
  test(`bundled ${kind} rejects oversized input before sync/async child parsing or later refinements`, async () => {
    let children = 0,
      refinements = 0;
    const child = bundled.preprocess((value) => {
      children++;
      return value;
    }, bundled.string());
    const schema = schemaFor(bundled, kind, child)
      .max(2, "Too many")
      .refine(() => {
        refinements++;
        return true;
      });
    for (const result of [
      schema.safeParse(inputFor(kind)),
      await schema.safeParseAsync(inputFor(kind)),
    ]) {
      assert.equal(result.success, false);
      assert.equal(result.error.issues.length, 1);
      assert.equal(result.error.issues[0].code, "too_big");
      assert.equal(result.error.issues[0].message, "Too many");
    }
    assert.equal(children, 0);
    assert.equal(refinements, 0);
    const wrongType = schema.safeParse(kind === "array" ? {} : []);
    assert.equal(wrongType.error.issues[0].code, "invalid_type");
  });

  test(`bundled ${kind} compiler emits its gate before allocation or child transforms`, () => {
    let visits = 0;
    const schema = schemaFor(
      bundled,
      kind,
      bundled.string().transform((value) => {
        visits++;
        return value.toUpperCase();
      }),
    ).max(2);
    const parser = bundled.core.compileFn(schema, { debug: true });
    const gate = `if (input.${kind === "array" ? "length" : "size"} > 2) return INVALID;`;
    assert.ok(parser.code.includes(gate));
    assert.ok(parser.code.indexOf(gate) < parser.code.indexOf("for ("));
    const compiled = bundled.core.compile(schema, { strict: true });
    assert.equal(compiled.safeParse(inputFor(kind)).error.issues.length, 1);
    assert.equal(visits, 0);
    const valid =
      kind === "array"
        ? ["a"]
        : kind === "map"
          ? new Map([["a", "a"]])
          : new Set(["a"]);
    assert.deepEqual(
      compiled.parse(valid),
      schemaFor(
        fixed,
        kind,
        fixed.string().transform((s) => s.toUpperCase()),
      )
        .max(2)
        .parse(valid),
    );
    assert.ok(visits > 0);
  });
}

test("array bounds, nested error paths, schema clones and transforms match upstream patched Zod", async () => {
  const factories = [
    (z) => z.array(z.string()).length(2),
    (z) => z.array(z.string()).max(0),
    (z) => z.array(z.string()).min(1).max(2),
    (z) => z.object({ values: z.array(z.string()).max(1, "limit") }),
    (z) =>
      z
        .array(z.number())
        .overwrite((values) => values.slice(0, 2))
        .max(2),
    (z) => z.array(z.string()).max(2).clone().readonly(),
    (z) => z.array(z.string()).max(2).optional(),
  ];
  for (const factory of factories) {
    for (const value of [
      [1, 2, 3],
      ["a", "b", "c"],
      [],
      ["ok"],
      undefined,
      { values: [1, 2] },
    ]) {
      assert.deepEqual(
        output(factory(bundled).safeParse(value)),
        output(factory(fixed).safeParse(value)),
      );
      assert.deepEqual(
        output(await factory(bundled).safeParseAsync(value)),
        output(await factory(fixed).safeParseAsync(value)),
      );
    }
  }
  let visits = 0;
  const large = bundled
    .array(
      bundled.preprocess((value) => {
        visits++;
        return value;
      }, bundled.string()),
    )
    .max(100);
  assert.equal(
    large.safeParse(Array(10_000).fill(null)).error.issues.length,
    1,
  );
  assert.equal(visits, 0);
});

test("skipChecks and backward/encode contexts retain upstream size-gate semantics", () => {
  for (const context of [{ skipChecks: true }, { direction: "backward" }]) {
    const schema = (z) => z.array(z.string()).max(1);
    assert.deepEqual(
      output(bundled.core.safeParse(schema(bundled), ["a", "b"], context)),
      output(fixed.core.safeParse(schema(fixed), ["a", "b"], context)),
    );
  }
});

test("direct shared core constructors used by framework internals also receive the backport", () => {
  const core = bundled.core;
  for (const kind of ["array", "map", "set"]) {
    const child = new core.$ZodString({ type: "string" });
    const checks = [
      kind === "array"
        ? new core.$ZodCheckMaxLength({ check: "max_length", maximum: 2 })
        : new core.$ZodCheckMaxSize({ check: "max_size", maximum: 2 }),
    ];
    const schema =
      kind === "array"
        ? new core.$ZodArray({ type: "array", element: child, checks })
        : kind === "map"
          ? new core.$ZodMap({
              type: "map",
              keyType: child,
              valueType: child,
              checks,
            })
          : new core.$ZodSet({ type: "set", valueType: child, checks });
    const input =
      kind === "array"
        ? [1, 2, 3]
        : kind === "map"
          ? new Map([
              [1, 1],
              [2, 2],
              [3, 3],
            ])
          : new Set([1, 2, 3]);
    const result = core.safeParse(schema, input);
    assert.equal(result.error.issues.length, 1);
    assert.equal(result.error.issues[0].code, "too_big");
  }
});

test("enabling the bundled memoizer does not bypass collection size rejection", () => {
  const previous = bundled.config().memoizer;
  try {
    bundled.config({ memoizer: bundled.core.memoizer() });
    for (const kind of ["array", "map", "set"]) {
      let visits = 0;
      const child = bundled.preprocess((value) => {
        visits++;
        return value;
      }, bundled.string());
      const schema = schemaFor(bundled, kind, child).max(2);
      assert.equal(schema.safeParse(inputFor(kind)).error.issues.length, 1);
      assert.equal(visits, 0);
    }
  } finally {
    bundled.config({ memoizer: previous });
  }
});
