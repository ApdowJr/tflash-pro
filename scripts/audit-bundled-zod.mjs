// Registry audits cannot see precompiled dependencies. Verify the actual runtime
// or an exact upstream backport; never waive the finding based on a marker alone.
import { readFile, realpath } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";

const chunk = "dist/src/compiled/_chunks/client/core-CspsxXR-.js";
const helper = "dist/src/compiled/_chunks/client/tflash-zod-size-guard.js";
const commit = "a0ebf970f2d752e5f58527cd2942ff48be4f46bd";
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

export async function verifyBackport(root, bundledVersion) {
  const record = JSON.parse(
    await readFile(
      new URL("../patches/eve-zod-backport.json", import.meta.url),
      "utf8",
    ),
  );
  const pkg = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
  if (
    pkg.name !== "eve" ||
    pkg.version !== "0.83.2" ||
    record.package !== pkg.name ||
    record.version !== pkg.version ||
    bundledVersion !== "4.5.4" ||
    record.bundledZod !== bundledVersion ||
    record.advisory !== "GHSA-mrhx-c7xc-m3w5" ||
    record.upstreamCommit !== commit ||
    Object.keys(record.files).sort().join() !== [chunk, helper].sort().join()
  ) {
    throw new Error("Unknown Eve/Zod backport: review the installed runtime");
  }
  for (const file of [chunk, helper]) {
    if (sha256(await readFile(new URL(file, root))) !== record.files[file])
      throw new Error(`Security backport integrity mismatch: ${file}`);
  }
  if (
    sha256(
      await readFile(
        new URL("../patches/eve-zod-size-guard.js", import.meta.url),
      ),
    ) !== record.files[helper]
  )
    throw new Error(
      "Backport source and installed helper differ; regenerate the pnpm patch",
    );
}

export async function auditBundledZod() {
  const root = pathToFileURL(`${await realpath("node_modules/eve")}/`);
  const z = await import(new URL("dist/src/compiled/zod/index.js", root).href);
  const { major, minor, patch } = z.core.version;
  if (![major, minor, patch].every(Number.isSafeInteger))
    throw new Error("Unknown bundled version format");
  const version = `${major}.${minor}.${patch}`;
  const vulnerable =
    major < 4 || (major === 4 && (minor < 6 || (minor === 6 && patch < 6)));
  if (vulnerable) {
    await verifyBackport(root, version);
    console.log(
      `Eve bundled Zod ${version}: exact upstream security backport verified (${commit})`,
    );
  } else console.log(`Eve bundled Zod: ${version}`);
  for (const kind of ["array", "map", "set"]) {
    let visits = 0;
    const child = z.preprocess((value) => {
      visits++;
      return value;
    }, z.string());
    const schema =
      kind === "array"
        ? z.array(child).max(2)
        : kind === "map"
          ? z.map(child, child).max(2)
          : z.set(child).max(2);
    const input =
      kind === "array"
        ? ["a", "b", "c"]
        : kind === "map"
          ? new Map([
              ["a", "a"],
              ["b", "b"],
              ["c", "c"],
            ])
          : new Set(["a", "b", "c"]);
    // Runtime sync/async AND compiled paths must reject before visiting children.
    for (const [label, result] of [
      ["sync", schema.safeParse(input)],
      ["async", await schema.safeParseAsync(input)],
      ["compiled", z.core.compile(schema, { strict: true }).safeParse(input)],
    ]) {
      if (
        result.success ||
        result.error.issues.length !== 1 ||
        result.error.issues[0].code !== "too_big" ||
        visits !== 0
      )
        throw new Error(
          `Release blocked: ${kind}/${label} size bound did not reject before child validation`,
        );
    }
    console.log(
      `${kind}: sync/async/compiled size gates PASS (0 child validations)`,
    );
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  try {
    await auditBundledZod();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
