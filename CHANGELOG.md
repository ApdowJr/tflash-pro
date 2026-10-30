# Changelog

## 2026-10-30 — public landing page and polish

`/` is now public. A signed-out visitor sees a bilingual landing page instead of
an immediate redirect to `/login`; a signed-in account still lands in a new chat.
See [docs/upgrade-2026-10-30.md](docs/upgrade-2026-10-30.md) for scope and
verification.

### Added

- Public, responsive landing page at `/` with EN/SO copy, feature overview,
  provider list, approval/security explanation, FAQ and a final sign-up path.
- Product preview and generated Open Graph card for link sharing.
- `sitemap.xml` (only when `APP_URL` is set) and a `robots.txt` that allows the
  landing page and `/login` while keeping chats, APIs, auth callbacks and Eve
  routes out of indexes.
- `/login?mode=signup` opens the create-account tab directly.
- Five tests covering crawl policy, sitemap origin handling, the root-route
  split, the signup deep link and the bilingual landing copy.

### Changed

- The root page resolves the session once and passes the principal to the chat
  shell instead of looking it up twice.
- Metadata now carries a canonical root, a public description, a social card and
  `metadataBase` from `APP_URL`.
- The manifest description matches the bilingual product copy.

## 2026-10-30 — database security advisor follow-up

Repository-only hardening for the three Supabase advisors. No production
migration, auth setting, deploy or push was performed. See
[docs/database-advisors-2026-10-30.md](docs/database-advisors-2026-10-30.md).

### Changed

- Added `supabase/migrations/20261030120000_harden_owner_proof_rpc.sql`, which
  revokes client execution of the out-of-band, `SECURITY DEFINER`
  `tflash_verify_owner_proof` RPC. The app's signed HMAC owner check is
  unchanged, and the RPC remains available to the database owner.
- Added migration/security tests covering the revoke, the fresh-project no-op,
  and the absence of runtime RPC call sites.

### Documented

- Leaked password protection is available on Pro and above; the exact Dashboard
  and Management API steps are documented. It was not enabled here.
- All three unused indexes are intentionally retained pending workload
  evidence; no index is dropped.
- Documented wider production schema drift, including the absent
  `tflash_messages` migration, trigger helpers, index mismatch, and excess
  `authenticated` table grants, with a safe reconciliation plan.

## 2026-10-29 — platform hardening

No user-facing feature or API contract was removed. See
[docs/upgrade-2026-10-29.md](docs/upgrade-2026-10-29.md) for rationale.

### Added

- `x-request-id` on wrapped API responses, with a hard 500 boundary that never
  leaks a stack trace.
- Structured server logging with key masking **and** credential-value scrubbing;
  `TFLASH_LOG_LEVEL` controls verbosity.
- In-process rate limits (`429` + `retry-after`) on provider test/connect/models,
  integration connect, document read/export, and chat creation.
- Route error boundary, global error boundary, and a bilingual 404 page.
- Offline/reconnect banner.
- Security headers (nosniff, referrer policy, permissions policy, COOP, HSTS)
  and `poweredByHeader: false`.
- `manifest.webmanifest` (installable, no service worker) and `robots.txt`.
- Per-conversation browser tab titles.
- 10 new tests covering redaction, response helpers, the route wrapper, and the
  rate limiter.

### Changed

- Shiki is loaded on demand instead of in the chat route's first load.
- Minor/patch dependency updates (AI SDK packages, React 19.3.1, Radix 1.8.1,
  Tailwind 4.3.3, Streamdown 2.7.1, and others). Eve, Shiki, Motion,
  `@vercel/connect`, `@types/node`, nanoid and TypeScript majors are held.

### Security

- `pnpm audit --audit-level=low`: no known advisories.
- The bundled-Zod backport gate for Eve still verifies the patched chunk hashes
  and the array/map/set rejection probes.
