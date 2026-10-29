# Eve 0.83.2 — Zod security backport

This is a **source backport**, not an advisory exclusion, runtime monkey-patch or framework upgrade. pnpm's `patchedDependencies` applies `eve@0.83.2.patch`; the lockfile pins its hash. No postinstall rewriting is used.

## Provenance and scope

- Finding: [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5).
- Upstream fix: [Zod commit a0ebf970f2d752e5f58527cd2942ff48be4f46bd](https://github.com/colinhacks/zod/commit/a0ebf970f2d752e5f58527cd2942ff48be4f46bd), [PR 6652](https://github.com/colinhacks/zod/pull/6652).
- `eve-zod-size-guard.js` is the readable MIT-licensed backport source. It keeps upstream check ordering, `when`, `skipChecks`, backward/encode behavior and schema attribution. The two existing minified utility bindings (`attachSchema` and `numericOperand`) are passed explicitly.
- Six integration points in the **shared** compiled core: three runtime collection parsers and three compiled fast-path emitters. This covers direct internal core constructors as well as the classic Zod entry. The bundle filename and all existing exports remain unchanged.
- `eve-zod-backport.json` records provenance, the original core SHA-256 and the resulting core/helper SHA-256 hashes. The audit checks installed bytes and the readable helper source, then runs semantic probes. It does not trust a “patched” marker alone.

The generated patch is large because the original shared chunk is minified. Review the small generator, helper source, hashes and regression tests together; the generator makes exactly six guarded substitutions and one helper import. It refuses any original core other than the exact reviewed SHA-256. It does **not** bump Zod's version label.

## Reproduce (maintainers only)

From the repository root, using Node 24:

```sh
corepack pnpm patch eve@0.83.2 --ignore-existing --edit-dir /tmp/tflash-eve-backport
node scripts/build-eve-zod-backport.mjs /tmp/tflash-eve-backport
corepack pnpm patch-commit /tmp/tflash-eve-backport
corepack pnpm install --frozen-lockfile
corepack pnpm run audit:security
corepack pnpm run audit:bundled-zod
corepack pnpm test
corepack pnpm typecheck
corepack pnpm build
corepack pnpm build:eve
```

Normal installation only needs `pnpm install --frozen-lockfile`; it must not require the generator. If the helper changes, regenerate the patch and manifest and review the resulting hashes. Do not hand-edit `node_modules`, the manifest or a version label to make the gate green.

Remove the backport when a compatible Eve release actually bundles the upstream fix: inspect its runtime, update the gate if packaging changes, remove the patch registration/source/manifest, regenerate the lockfile and rerun the same checks. Never silently apply this patch to a different Eve version.

This fix makes existing leading size bounds effective before parsing collection elements. Like upstream, it does **not** introduce bounds or a universal issue cap for unbounded schemas; request/provider input limits and runtime resource controls still matter.
