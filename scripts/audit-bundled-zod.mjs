// Registry audits cannot see Eve's precompiled dependencies. Read, do not patch,
// the installed runtime; a changed layout must be reviewed rather than skipped.
import { realpath } from "node:fs/promises";
import { pathToFileURL } from "node:url";

try {
  const eveRoot = pathToFileURL(`${await realpath("node_modules/eve")}/`);
  const z = await import(
    new URL("dist/src/compiled/zod/index.js", eveRoot).href
  );
  const { major, minor, patch } = z.core.version;
  if (![major, minor, patch].every(Number.isSafeInteger))
    throw new Error("Unknown bundled version format");
  console.log(`Eve bundled Zod: ${major}.${minor}.${patch}`);
  // Tiny probe: a fixed size bound rejects before visiting child elements.
  let visits = 0;
  const result = z
    .array(
      z.preprocess((value) => {
        visits++;
        return value;
      }, z.string()),
    )
    .max(2)
    .safeParse(Array(16).fill(null));
  console.log(
    `Oversized bounded collection: ${visits} child validations, ${result.error?.issues.length ?? 0} issues (expected 0, 1)`,
  );
  if (
    result.success ||
    visits !== 0 ||
    result.error.issues.length !== 1 ||
    major < 4 ||
    (major === 4 && (minor < 6 || (minor === 6 && patch < 6)))
  ) {
    throw new Error(
      "Release blocked: bundled Zod needs review/fix for GHSA-mrhx-c7xc-m3w5 (4.x patched in 4.6.6). pnpm overrides do not replace compiled dependencies.",
    );
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
