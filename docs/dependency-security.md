# Dependency security — updated 2026-11-08

## Registry advisories

The 2026-10-29 audit reported 56 advisories: 7 critical, 20 high, 18 moderate and 11 low. The 2026-11-08 lockfile update again reports **0** at every severity, including development dependencies. No advisory exclusions, severity relaxations or `continue-on-error` steps were added.

- Current direct pins include Next.js 16.4.5, Eve 1.0.0-rc.6, Better Auth 1.7.18, AI SDK 7.0.165, Zod 4.6.7, jsdom 31.0.0, pnpm 12.18.0 and Node 24.22.2. See [the 2026-11-08 upgrade record](upgrade-2026-11-08.md) for the full inventory.
- Scoped pnpm overrides: Undici 7.30.1 / 8.12.3 (keep majors separate), DOMPurify 3.4.17, source-map-js 1.2.2, KaTeX 0.19.1, Zod 4.6.7, sharp 0.35.5.
- KaTeX has no patched 0.16 release; 0.18.11 is deprecated for accidental breaking changes. Use the tested 0.19.1 renderer. The real Streamdown math plugin/CSS resolution is regression-tested.
- Remove overrides only when supported upstream ranges require the security floor and audits/tests/builds still pass. Do not collapse Undici 7 and 8 into one major.

## Compiled Zod: upstream security fix backported

Eve 1.0.0-rc.6 still embeds **Zod 4.5.4**, affected by [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5). Registry audits and external `zod` overrides do not inspect or replace that compiled code. This previously caused the separate CI release gate to fail.

This patch applies the official upstream [bounded-collection fix](https://github.com/colinhacks/zod/commit/a0ebf970f2d752e5f58527cd2942ff48be4f46bd) through **pnpm's version-pinned patch mechanism**. Three runtime parsers and three compiled emitters in Eve's shared Zod core now reject oversized arrays, maps and sets before parsing children. It changes only the pinned Eve runtime chunk and helper; the application's v1 agent, event and connection migration is handled separately. It is not an ad-hoc postinstall rewrite. The bundled version still honestly reports 4.5.4.

The gate remains enabled. For this release candidate it requires Eve 1.0.0-rc.6, the exact recorded shared-core/helper SHA-256 hashes, matching readable source and sync/async/compiled behavior probes. Missing, tampered, unknown or regressed backports fail closed. An actual upstream patched version must still pass the probes. See [backport provenance and reproduction](../patches/README.md).

A safe control probe against the original unpatched package still walks every oversized element; the backported package rejects with **0 child validations and 1 size issue**. Tests compare bounded/nested/clone/transform behavior with external Zod 4.6.7, check direct core constructors and memoization, and test corrupted/missing patch rejection. An empty-directory frozen-lockfile install reproduced the fix without using the development `node_modules` tree.

**Limitations:** upstream's fix makes leading size constraints reject early; it does not add a universal issue cap or bounds to unbounded schemas. Input-size/count limits, provider controls and deployment resource limits remain necessary. This targeted check is not a comprehensive inventory of all vendored libraries or a claim of complete production security clearance.

## Reproduce

Use Node 24.22.2 and the pinned pnpm:

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm run audit:security
corepack pnpm run audit:bundled-zod
corepack pnpm test
corepack pnpm typecheck
corepack pnpm build
corepack pnpm build:eve
```

Normal installation applies the committed patch automatically. Only maintainers regenerating it need the generator documented in `patches/README.md`.

## Local verification

The 2026-11-08 local run passed: frozen install, both audits, **486/486 tests**, typecheck, Next/Eve builds, and an isolated empty-directory frozen install with the bundled-Zod gate. Full details are in [the upgrade record](upgrade-2026-11-08.md). Remote CI is reported separately. No live login, email confirmation, OAuth consent, model call, hosted migration or production deployment was performed.

## Remaining rollout checks

Auth/provider transports in tests are mocked. Existing Vercel and Supabase sign-in, account/session binding, provider selection (including OpenRouter), and fresh tool approvals remain covered. Better Auth warns when mocks lack a client IP; validate trusted platform forwarding/rate limits rather than disabling the limiter or trusting arbitrary client headers. Also validate document workers, both logins/providers/consents/approvals on a preview and confirm production sandbox/workflow persistence readiness. Production rollout remains a separate authorized step.
