# Changelog

## 2026-11-05 — model picker entry points

The picker dialog existed and the top bar already listened for a
`tflash:open-model-picker` event, but nothing in the interface dispatched it,
so the only visible path to a model change was Settings → Providers.

### Added

- A model chip in the composer footer showing the active provider/model; one
  tap opens the existing picker. It renders only when the caller supplies the
  picker, so embedded composers are unchanged.
- A **Choose a model** item in the top bar's more menu, before New chat.

### Changed

- `ChatComposer` accepts an optional `onOpenModels` prop; the chat shell wires
  it to the same picker state the top bar already used.
- The top bar test now asserts the menu entry opens the picker instead of
  asserting the control was absent.

## 2026-11-05 — defect fixes

### Fixed

- `waitWithAbort` could wait forever: deadline signals built with
  `AbortSignal.timeout()` use unref'ed timers, so when nothing else held the
  event loop the process drained before the deadline fired and the pending wait
  never settled. Five catalog-reliability tests were cancelled by that hang.
  The wait now keeps the event loop referenced until it settles or aborts and
  clears that handle on either path.
- Canonical links, Open Graph images and Twitter cards fell back to
  `http://localhost:3000` whenever `APP_URL` was unset, including on a Vercel
  deployment where the README documents `VERCEL_URL` as sufficient. The origin
  now resolves through `lib/public-origin.ts` with the same precedence as the
  internal Eve origin (`APP_URL`, then `VERCEL_URL`, then localhost), rejects
  non-HTTP(S) and credential-bearing values instead of failing the build, and
  keeps an optional base path for subdirectory deployments.

### Added

- Regression tests for the public metadata origin and for the layout no longer
  hard-coding a localhost canonical URL.

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
