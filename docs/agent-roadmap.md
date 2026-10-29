# Agent capabilities: phased delivery

## Three explicit operating modes

The workspace exposes **Chat**, **Coder**, and **Research** as per-conversation modes. Selection is scoped to the signed-in account and chat in browser storage and is included as bounded client context on normal turns and approval responses. It is a preference, not a permission grant: existing shell/MCP approvals and higher-priority safety rules remain authoritative.

- **Chat**: general assistance, writing, explanation and file-based help; use tools when they materially improve the answer.
- **Coder**: inspect the actual connected repository before editing; make minimal coherent changes, add regression tests, run available checks, and report exact evidence. The temporary shell sandbox is not the user's repository unless the connection explicitly proves it.
- **Research**: search, read public sources through the approved fetch tool, cite fetched evidence, separate source facts from synthesis, and create reports only from real receipts. Search/fetch availability remains provider-dependent.

The selector does not provision a persistent code VM or grant GitHub access by itself. Coder capability depends on the connected GitHub integration and the approvals available in the deployment. Research depends on the selected provider's search support and public-source access.

## Account workspace sync

For Supabase-authenticated accounts, project instructions, manually managed memory notes, memory opt-in, and model-call limits can sync to a per-user `tflash_workspaces` row protected by RLS. Browser storage remains a recovery copy and the Settings panel surfaces sync status. A cloud error must not silently overwrite the local copy. Vercel-only accounts remain browser-local because they do not have a Supabase user JWT. The migration is part of the PR and must be reviewed/applied separately; this change does not mutate production. This PR aligns the chat migration filename with the linked Supabase project's applied version (`20261028075927`) after checking the live table's columns, index, and RLS policies against the migration. Verify `supabase migration list` and review the diff before any migration push; the new workspace migration remains unapplied.


## Phase 1 — task execution visibility and text deliverables

Implemented in this branch:

- `update_plan` is a real authored tool with a validated full plan snapshot (up to 12 steps). The current plan is derived from settled assistant tool results in the current transcript, not from user text or an in-flight tool input. Replaying a transcript restores its latest valid plan; no new cross-account store is introduced.
- The compact plan above the conversation shows the actual run state (working, awaiting a response, stopped/idle, resuming, failed) separately from the agent-reported checklist. A stopped run does not imply all steps completed. Historical plan updates remain in the conversation.
- `create_artifact` emits a bounded text deliverable, rendered as a preview and download card. Supported formats: `.md`, `.txt`, `.csv`, valid `.json`; at most 100,000 characters. Names cannot contain paths or control characters. Content is displayed as inert text, never executed or rendered as HTML.
- The download contains the generated text, not a placeholder link. Downloads are initiated only by user clicks. Review generated content, especially spreadsheet formulas. Unsupported formats such as PDF are rejected rather than given a misleading extension.
- An unfinished idle/failed plan offers **Continue task**. Clicking sends a normal follow-up in the same owned chat, asks the agent to check prior results rather than repeat completed external actions, and does not bypass any tool approval. It does not schedule work or resume a cancelled workflow in the background.
- Existing failed-send recovery, stop controls, human questions, and per-call shell/MCP approvals are preserved. Planning itself does not run commands or grant permission for external actions.

Plans are agent reports, not independently verified execution evidence. A plan tool records only its metadata; the agent must use other tools to do and verify the work. Artifacts live in conversation tool results, subject to the same session ownership and workflow retention as transcripts. They are not uploaded to a shared public bucket or synchronized as cross-chat memory. The download card requires no sandbox, but actual shell work still requires a configured production sandbox.

Local tests exercise actual tool executors, validation, replay projection, bilingual cards and exact download contents. No live model/tool execution or production sandbox has been established by these tests.

## Phase 2 — research

Implemented locally; no production deployment or live provider search is implied:

- Keeps Eve 0.83.2's `web_search` integration rather than introducing a second search service/key. AI Gateway retains its existing Exa default. Supported direct OpenAI, Anthropic and Google models use provider-native search; other direct providers (including OpenRouter, Groq, Ollama and custom compatible endpoints) may omit search. Native search can also be rejected by a model. There is no silent provider switch or promise of universal search; public URLs can still be read through the fetch tool. Hosted search is subject to the selected provider's billing/availability.
- Overrides `web_fetch` through Eve's public API, retaining public-network checks, pinned DNS, per-hop redirect validation, bounded response size and cancellation. Initial URLs must be HTTPS without credentials or custom ports. Fresh approval is required for every fetch. This sends a read request to the public destination; no credentials/private data should be included in a URL. Pages remain untrusted data. Shell/MCP approvals are unchanged.
- Emits inert source cards with requested URL, server retrieval time, bounded excerpt and a partial-content indicator. Eve returns the **requested**, not final redirected URL. It does not expose HTTP status in its output; this wrapper rejects Eve's non-success prefix, empty content and declared binary/PDF types. It is not a browser, a paywall bypass, or independent fact-checking. Network/timeouts/cancellation fail without a successful receipt.
- Seals retrieved metadata into seven-day AES-GCM receipts using the existing server credential secret, explicitly bound to authenticated account + Eve session. There is no new public source store. Tampered, expired, wrong-account/chat receipts are rejected. Receipts and tool content remain in the existing owned transcript under its retention policy; expiry prevents new reports, not viewing/download of already-created reports. A missing or rotated server secret can prevent report creation; re-fetch affected sources.
- `create_research_report` accepts 1–12 real fetch receipts, 1–24 findings each with validated numeric citations, a summary and explicit limitations. It produces an actual `.md` artifact with source URLs, timestamps and excerpts. Citation indexes are validated, but semantic claim support is not automatically verified. Findings are model-written synthesis, labelled as such. No PDF/Office output or sandbox is needed.
- Source/report cards and a research starter prompt work in English/Somali. Reports reuse the inert preview and exact-content user-initiated download; raw remote HTML is never inserted into the page.

Local tests execute the real wrapper and report tools with mocked HTTP responses, exercising literal/redirect SSRF rejection, errors, cancellation, oversized/truncated content, receipt ownership/expiry/tampering, citations, bilingual rendering and exact report downloads. They do not establish live DNS rebinding behavior, provider-native search availability, live model tool choice, or production connectivity. DNS protections are inherited from the pinned framework fetcher, not reimplemented.

## Phase 3 — projects and user-controlled memory

The first release was browser-local. This PR adds account-scoped cloud sync for Supabase-authenticated users while keeping Vercel-only accounts browser-local. It adds a `tflash_workspaces` table with per-user RLS and a validated, size-bounded same-origin API. The migration is committed but is not applied to production by this PR. No service-role key is used.

- Strict, versioned workspace schema; per-login-kind/account storage keys; 20 projects, 30 notes, unique ids and single-project chat membership. An account switch renders an empty workspace until that account is loaded, never the preceding account's context. Changes persist before showing success; storage errors are visible. Cross-tab storage events refresh the workspace.
- Create/edit/delete projects and instructions. A selector above the composer assigns the current chat; project cards link to their conversations, whose transcript holds their files/reports. There is no separate file bucket or cross-project file search.
- Memory is manually curated and **off by default**. Review/edit/delete notes, global/project scope, per-note inclusion and global opt-out. Project deletion removes its scoped notes, not conversations. Export JSON backups or clear all with confirmation. There is no automatic model-side capture/write tool or backup import.
- Selected project instructions (up to 4,000 characters) and enabled applicable notes (up to 6,000 characters; excess notes are omitted with a count in model context) join each send/approval response as bounded untrusted user data, never tool approval or system authority. No unrelated project's notes are supplied. Notes are sent to the selected model when the user submits.
- Storage is local, not encrypted or cross-device synced. Browser storage is not a security boundary against someone with access to the browser profile. Do not store credentials. Deletion stops **new injection**, not erasure of historical prompts/provider copies or forensic erasure of browser storage. Existing conversations may still contain/use earlier information; start a new chat for clean context.

## Activity and usage limits

- Collapsible current-chat activity projection from real tool parts and durable task events: partial snapshots/task receipts are not successful completion. Approval decisions/outcomes and available event times are shown, without arguments, results or credential fields. A JSON summary is downloadable. It is not a full audit ledger; visible rows are bounded to the latest 200 (export includes the projected calls). Old events can lack timestamps.
- Usage prefers Eve's cumulative checkpoints (including delegated spend), adding newer own-session steps. Stream ids deduplicate overlapping replay; step coordinates avoid counting the same visible retry twice. Historical retry billing cannot be reconstructed from an ambiguous stream. Costs are sums of reported costs, potentially partial; absent cost stays unknown. No price lookup or fabricated estimate, no tool/infra/compaction invoice coverage.
- A durable hook counts unique step indexes per turn and calls Eve's `ctx.cancel()` **before** an excess model call. Browser setting: 1–30, default 12; the authenticated channel validates it on every request. New turns reset the allowance; retries of the same step do not increment it. Copies/delegated sessions have separate counters, not an account-wide aggregate. This is a model-call limit, not a tool-call/spend guarantee.
- Eve runtime usage windows pause for explicit continuation after 250,000 uncached input tokens, 30,000 output tokens or USD 2 of reported cost. The crossing call finishes; costs may be missing. It is not a hard dollar cap. Existing shell/MCP approvals remain fresh per call. No automatic approval, spending, scheduling or background resume.

## PDF / DOCX

- Authenticated same-origin POST routes read bounded uploads and generate genuine binary downloads, both `no-store`; nothing is uploaded to an external conversion service or persisted by these routes. Files sent with a chat remain subject to that transcript/provider's retention.
- Reads: 2 MiB upload, up to 50 PDF pages / 100,000 text characters. No OCR/encrypted PDF support. DOCX reads only `word/document.xml`, not headers/footers, tracked layout or images; ignores external relationships/macros. ZIP entry count 256, declared total expansion 20 MiB, main XML 1 MiB with streamed byte enforcement; rejects encrypted/duplicate parts and DOCTYPE. No XML external entity resolver.
- Parsing is isolated in a Node worker, terminated after 12 seconds, with V8 heap/stack limits and at most two active readers per process. These are not OS-wide memory/rate quotas; deployment limits still apply. Extraction inserts a plain-text attachment for review, never sends automatically. The composer sends such text as text content, supporting providers that cannot read arbitrary file MIME types.
- Markdown/plain-text artifact cards offer PDF/DOCX conversion only on user clicks. Up to 50,000 characters / 2,000 lines; PDF maximum 100 pages. PDF embeds bundled Noto Sans with its OFL license from `notofonts/noto-fonts` (`hinted/ttf/NotoSans/NotoSans-Regular.ttf`). Unsupported glyphs fail with DOCX/original-text fallback; plain text is not a rich Markdown renderer. Exported formats do not preserve source layout.
- Next file tracing explicitly includes the parser, PDF.js worker/font/CMap resources and bundled export font. A local standalone-copy smoke exercised only the files in the production route trace: PDF/DOCX extraction passed without development modules. PDF.js can warn about absent optional native canvas rendering; rendering is not used or supported here. Production worker/runtime deployment remains unverified.

## Validation and rollout

Local tests cover strict schemas, project membership/deletion, opt-in scoped/bounded context, account/login-kind isolation in the real provider/UI, storage failures, edit/delete confirmations, actual server hook cancellation with a mocked durable slot, usage/approval/task projections, real PDF/DOCX round trips, malformed/unsafe archives, scanned/oversize PDFs, route login/origin checks for both principal kinds, and user-initiated UI import/export. Provider transports/authentication are mocked; no live model selection/tool use or production connectivity is established. Production deployment is a separate explicit step.

### Dependency security

The 2026-10-29 dependency update reduced the registry audit from **56 advisories (7 critical, 20 high, 18 moderate, 11 low) to 0**, including development dependencies and without advisory suppressions. Auth/provider, sanitizer, math and real Undici DNS-dispatch regressions accompany the update.

The separate compiled-Zod finding is addressed by a pnpm-applied, version-pinned backport of Zod's official bounded-collection fix into Eve 0.83.2. The gate still runs: it accepts only exact verified backport bytes (or a patched upstream version), plus passing sync/async/compiled array/map/set probes. It does not suppress an advisory or pretend the bundled version was upgraded. See [dependency security](dependency-security.md) for provenance, regression coverage and reproduction.

Local registry/bundled audits, tests and builds pass with the fix. Live service connectivity, preview behavior and production sandbox/workflow readiness remain unverified; production rollout is a separate authorized step.
