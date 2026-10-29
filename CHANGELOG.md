# Changelog

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
