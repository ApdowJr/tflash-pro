# Dependency security — 2026-10-29

## Registry advisories remediated

The initial audit reported 56 advisories: 7 critical, 20 high, 18 moderate and 11 low. The updated lockfile reports **0** at every severity, including development dependencies. No advisory exclusions or severity relaxations were added.

- Direct updates: Next.js 16.4.3, Better Auth 1.7.14, nanoid 5.1.16, Zod 4.6.7.
- Scoped pnpm overrides: Undici 7.30.1 / 8.12.3 (keep majors separate), DOMPurify 3.4.17, source-map-js 1.2.2, KaTeX 0.19.1, Zod 4.6.7, sharp 0.35.5.
- KaTeX has no patched 0.16 release; 0.18.11 is deprecated for accidental breaking changes. Use the tested 0.19.1 renderer, not that deprecated release. The real Streamdown math plugin and its CSS resolution are regression-tested.
- Remove overrides only when the owning dependency's supported range has the required security floor and the lockfile, tests, audit and builds still pass. Do not collapse Undici 7 and 8 into one major.

Reproduce with Node 24 and the pinned pnpm:

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm run audit:security
corepack pnpm run audit:bundled-zod  # currently exits 1: real release blocker
corepack pnpm test
corepack pnpm typecheck
corepack pnpm build
corepack pnpm build:eve
```

CI fails closed on new registry advisories, audit service errors and the bundled-Zod finding. **CI is intentionally not green while the latter remains.** Do not bypass it to merge/deploy.

## Separate bundled-runtime release blocker

The installed Eve 0.83.2 runtime's compiled Zod exports `core.version = { major: 4, minor: 5, patch: 4 }`. Its compiled entry and shared chunks contain this copy; installing/overriding the external `zod` package does not replace it.

[GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5) affects Zod 4 before 4.6.6: large failing collections can allocate unbounded validation issues and exhaust memory. Registry audits do not inventory code vendored inside published packages. `scripts/audit-bundled-zod.mjs` reads the installed compiled version, rejects the affected version and fails closed if its packaging changes; a tiny bounded-array probe also verifies that the size check runs before child validation. It does not edit framework code. This is a targeted check, **not** a comprehensive scan of all vendored libraries.

Application schemas and document routes have input limits, but those alone are not evidence that every framework transport, provider response or tool-result validation path is protected. Exploitability in the deployed app has not been established or ruled out. Do not claim a complete fix or ship based only on `pnpm audit` returning zero.

A safe local probe using a 2,000-item invalid array with `.max(100)` confirmed the difference: external Zod 4.6.7 visited **0** children and produced **1** issue; Eve's bundled copy visited **2,000** children and produced **2,001** issues. The upstream fix makes collection size bounds reject early; it does **not** add a default issue cap to unbounded arrays. Input-size/count limits remain necessary even with a patched version. See [the upstream bounded-collection fix](https://github.com/colinhacks/zod/pull/6652).

Release requires an Eve build containing patched Zod (verify the compiled runtime, not just its manifest), or a reviewed mitigation covering relevant input paths and memory behavior, followed by full regression checks. Do not rewrite generated chunks or force an unrelated framework migration. The registry's latest Eve metadata inspected during this pass still dev-pins Zod 4.5.4; a framework upgrade alone has not been validated as a fix. No upstream issue was published or production configuration changed by this work.

## Regression scope and remaining release checks

Tests preserve both login paths, stateless Vercel account/session binding, callback state-cookie rejection, provider selection and approval gates. Added security checks exercise the actual Mermaid DOMPurify sanitizer, KaTeX inherited-trust rejection, Streamdown math rendering and the real fetch/Undici dispatcher with private/mixed DNS answers (only OS DNS is mocked; no connection should be attempted).

Auth/provider transports remain mocked; no real login, email confirmation, OAuth consent or model call is claimed. Better Auth warns when mocked requests lack a client IP; validate trusted platform forwarding/rate limits during preview testing rather than disabling the limiter or blindly trusting arbitrary client headers. Before rollout, also resolve the bundled-runtime finding, validate both logins/providers/approvals and document workers on a preview, and provision the production sandbox/workflow persistence. Production rollout remains a separate authorized step.

### Local verification of this patch

| Check | Result |
| --- | --- |
| Frozen-lockfile install; full registry audit | PASS; 0 advisories at all severities |
| Unit, security and mock-service/UI tests | PASS; 95/95 |
| Typecheck; Next.js build; Eve build | PASS |
| Production-trace-only PDF/DOCX parser smoke | PASS; 967 traced entries, no native canvas required |
| Bundled Zod version + bounded-array gate | **BLOCKED**; 4.5.4 visits all 16 probe elements and produces 17 issues instead of rejecting before child validation |

These are local results, not a claim that remote CI or live service tests have passed.
