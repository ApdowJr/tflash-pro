# Agent capabilities: phased delivery

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

## Phase 3 — projects and user-controlled memory (not implemented)

- Define account ownership for both login systems before choosing storage.
- Let users review, edit, delete and opt out of saved project instructions/notes.
- Keep retrieved notes explicitly separate from system instructions and credentials.
- Add access-control, deletion, retention and account-isolation tests before deployment.

No scheduling, unattended background execution, automatic spending, or approval bypass is enabled by this work. Later phases need their own implementation and tests; they are not capabilities the assistant should claim today.
