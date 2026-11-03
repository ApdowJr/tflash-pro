// Maintainer-only generator for `pnpm patch eve@<version> --edit-dir <dir>`.
// Not a postinstall hook. pnpm applies the committed, lockfile-hashed patch.
import { readFile, writeFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

const directory = process.argv[2];
if (!directory)
  throw new Error(
    "Usage: node scripts/build-eve-zod-backport.mjs <pnpm-patch-directory>",
  );
const hash = (text) => createHash("sha256").update(text).digest("hex");
// Only runtimes whose shared core has been reviewed for these exact anchors.
const reviewedRuntimes = {
  "1.0.0-rc.1":
    "4940e7a6ca0ca3a2e6295a76fe9d742f8c94ceb27f9356f471711196520c7145",
};
const clientDir = "dist/src/compiled/_chunks/client";
const helper = `${clientDir}/tflash-zod-size-guard.js`;
const pkg = JSON.parse(
  await readFile(path.join(directory, "package.json"), "utf8"),
);
const cores = (await readdir(path.join(directory, clientDir))).filter((file) =>
  /^core-.+\.js$/.test(file),
);
if (cores.length !== 1)
  throw new Error(
    `Expected one shared Eve core chunk, found ${cores.length}: review the new runtime`,
  );
const chunk = `${clientDir}/${cores[0]}`;
const originalSha256 = reviewedRuntimes[pkg.version];
let source = await readFile(path.join(directory, chunk), "utf8");
if (!originalSha256 || hash(source) !== originalSha256)
  throw new Error(
    "Unexpected Eve version/chunk: review the new runtime rather than guessing patch offsets",
  );
function replaceOnce(before, after) {
  if (source.split(before).length !== 2)
    throw new Error(`Backport anchor changed: ${before}`);
  source = source.replace(before, after);
}
// Three runtime parsers, immediately after their parse closures are installed.
replaceOnce(
  "return o.length?Promise.all(o).then(()=>r):r}});function Ui",
  "return o.length?Promise.all(o).then(()=>r):r};tflashCapSize(e,input=>Array.isArray(input)?input.length:-1,Oe)});function Ui",
);
replaceOnce(
  "return o.length?Promise.all(o).then(()=>r):r}});function da",
  "return o.length?Promise.all(o).then(()=>r):r};tflashCapSize(e,input=>input instanceof Map?input.size:-1,Oe)});function da",
);
replaceOnce(
  "return o.length?Promise.all(o).then(()=>r):r}});function pa",
  "return o.length?Promise.all(o).then(()=>r):r};tflashCapSize(e,input=>input instanceof Set?input.size:-1,Oe)});function pa",
);
// Three compiled fast paths. Reject before allocating/walking child values.
replaceOnce(
  "function _l(e,t,n,r,i=!0){let a=n._zod.def;e.write(`if (!Array.isArray(${r})) return INVALID;`);",
  "function _l(e,t,n,r,i=!0){let a=n._zod.def;e.write(`if (!Array.isArray(${r})) return INVALID;`);tflashGenerateSizeGate(e,n,`${r}.length`,W);",
);
for (const [fn, type] of [
  ["jl", "Map"],
  ["Ml", "Set"],
]) {
  const start = `function ${fn}(e,t,n,r){let i=n._zod.def;e.write(\`if (!(\${r} instanceof ${type})) return INVALID;\`);`;
  replaceOnce(start, `${start}tflashGenerateSizeGate(e,n,\`\${r}.size\`,W);`);
}
source =
  'import { capSize as tflashCapSize, generateSizeGate as tflashGenerateSizeGate } from "./tflash-zod-size-guard.js";\n' +
  source;
const guard = await readFile(
  new URL("../patches/eve-zod-size-guard.js", import.meta.url),
  "utf8",
);
await writeFile(path.join(directory, chunk), source);
await writeFile(path.join(directory, helper), guard);
await writeFile(
  new URL("../patches/eve-zod-backport.json", import.meta.url),
  JSON.stringify(
    {
      package: "eve",
      version: pkg.version,
      bundledZod: "4.5.4",
      advisory: "GHSA-mrhx-c7xc-m3w5",
      upstreamCommit: "a0ebf970f2d752e5f58527cd2942ff48be4f46bd",
      originalSha256,
      files: { [chunk]: hash(source), [helper]: hash(guard) },
    },
    null,
    2,
  ) + "\n",
);
console.log(
  "Generated pinned Eve/Zod security backport; run pnpm patch-commit and all audits/tests/builds.",
);
