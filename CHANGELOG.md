# Changelog

## 2026-10-31 — Eve 1.0 and held dependency majors

Full platform upgrade with no intended UI change. See
[docs/upgrade-2026-10-31.md](docs/upgrade-2026-10-31.md) for the migration and
verification record.

### Changed

- Eve `0.83.2` → `1.0.0-rc.1`: v1 session view, message parts, interactions,
  `task.ended` facts, incremental `usage.recorded` totals and stream version 27.
- Shiki `3.23.0` → `4.5.0`, Motion `12.40.0` → `14.9.0`, nanoid `5.1.16` →
  `6.0.2`, `@vercel/connect` `0.4.2` → `2.7.0`, `@types/node` `24.13.2` →
  `26.6.6`, `@streamdown/code` `1.1.1` → `2.0.0`, and current AI SDK patch
  releases.
- Agent model resolution uses the v1 `defineDynamic` resolver; the model-step
  budget counts `model.started` run ids, so replays stay idempotent.
- Stop recovery uses `turn.settled { outcome: "cancelled" }`; input-response
  recovery uses `interaction.settled`. Approval/question payloads carry
  `interactionId`, while the exported `AgentInputResponse` name is preserved.
- Chat search indexes only rendered conversation text and ignores transport
  records; plan, artifact and research cards keep their existing styling.

### Security

- Regenerated the pinned pnpm source backport for Eve 1.0.0-rc.1's bundled Zod
  4.5.4 (`GHSA-mrhx-c7xc-m3w5`), with exact chunk hashes and behavior probes.
- `pnpm audit --audit-level=low`: no known advisories.
- Verification: 450 tests pass, typecheck is clean, Next and Eve production
  builds succeed, and both security audits pass.

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
