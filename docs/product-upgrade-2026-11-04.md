# Tflash product upgrade plan

Date: 2026-11-04

## Product decisions

- Chat, Coder, and Research use separate conversations. A conversation keeps its mode, context, capabilities, and history grouping.
- Coder grows into a real coding workspace with repository context, plans, files, code viewing/editing, diffs, command results, and approvals. IDE surfaces must be backed by observed sandbox/repository data; no fabricated files, output, or progress.
- Research defaults to a deep workflow: discover, read, compare, synthesize, cite, and export. Retrieval and AI synthesis remain distinguishable.
- Existing user-selected model providers and encrypted provider connections remain the AI runtime.

## Phase 1 — Product and UX foundation

Status: complete. Focused mode/workspace UI tests: 163 passed. TypeScript: passed.

- Establish a restrained bilingual design system that works in light and dark themes.
- Rebuild the application shell, navigation, mode selection, empty states, composer, and responsive behavior around three distinct jobs.
- Make mode selection explicit before a conversation starts and keep it stable for that conversation.
- Preserve authentication, chat ownership, provider selection, approvals, recovery, projects, and existing accessibility behavior.
- Add focused tests and run the relevant validation before continuing.

## Phase 2 — Chat experience

Status: complete. Combined mode/workspace UI tests after completion: 163 passed. TypeScript: passed.

- Memoize historical messages and actions, stabilize approval/question callbacks, and keep user-authored text literal.
- Improve assistant Markdown containment, streaming readability, touch actions, and reduced-motion behavior.
- Replace the motion-based shimmer with lightweight CSS and remove the unused direct motion dependency.
- Keep general attachments and voice available without forcing coding or research workflows.

## Phase 3 — Coder workspace

Status: complete for the implemented workspace scope. Combined agent, chat-route, recovery, voice, Coder, and workspace tests: 297 passed. TypeScript and `git diff --check`: passed. Eve production compilation under Node 24.22.2: passed.

- Bind the selected mode on the first real model turn with Eve's session memo, then expose mode-specific system instructions and Coder-only shell, file, search, patch, clone, and workspace tools.
- Add responsive side-by-side Chat/Workspace layouts on large screens and an explicit layout switch on smaller screens.
- Connect the file tree, text editor, Git status/diff, terminal/check results, plan, diagnostics, and approval counts to settled tool observations. Plans and command results remain available before the first snapshot.
- Keep editor drafts explicitly unsent until Coder applies them. Complete-file writes require approval and the latest observed SHA-256, reject stale or truncated files, and verify the persisted content by reading it back.
- Support approved public HTTPS clones from GitHub, GitLab, and Bitbucket into an empty sandbox without URL credentials. Existing provider connections and authentication/ownership checks remain unchanged.
- Bound file/diff output, reject traversal and Git/Eve/environment-secret paths, and preserve uncertain-outcome recovery for Coder-initiated sends.

Verification environment notes:

- The npm-distributed Node 24 runtime was installed only under `/tmp`; no runtime binary or build output was added to Git.
- Eve reported that this machine has no production sandbox provider (not Vercel and no Docker daemon). Deployed sandbox behavior still requires live validation.
- The AI Gateway catalog was unreachable from this network. The existing root model resolver supplies `modelContextWindowTokens`, so its configured provider path does not depend on that catalog.
- No live provider, remote clone, or production sandbox execution was claimed by these checks.

## Phase 4 — Deep Research workspace

Status: complete for the implemented workspace scope. Combined agent, chat-route, recovery, voice, Coder, Research, and workspace tests: 303 passed. TypeScript and `git diff --check`: passed. Eve production compilation under Node 24.22.2: passed.

- Add a dedicated research brief with question, scope, time frame, and deliverable controls. Research instructions default substantial investigations to an agent-updated discover/read/compare/synthesize plan.
- Project settled native and legacy provider results from OpenAI, Anthropic, Exa, and Parallel into deduplicated HTTPS search leads. Pending, failed, partial, unsafe, and lookalike outputs do not become evidence.
- Keep search snippets separate from receipt-backed `web_fetch` evidence. The workspace supports source inspection, two-source excerpt comparison, explicit synthesis requests, and genuine Markdown report download.
- Preserve receipt-backed source metadata when resumed history lacks full page text; allow an explicit refetch instead of presenting that metadata as complete retrieved content.
- Restrict `create_research_report` to Research mode and support native Eve `update_plan` results as well as legacy dynamic-tool history.
- Reuse the responsive Chat/Workspace shell, guarded submissions, approval review, and coarse-pointer touch targets without giving Research access to Coder tools.

The Phase 3 environment limitations still apply: these checks do not certify a live search/model provider, deployed retrieval, or production sandbox behavior.

## Phase 5 — Performance and release quality

Status: complete for the implemented release scope. Full repository suite: 476/476 tests passed under Node 24.22.2. TypeScript and `git diff --check`: passed. Next.js 16.4.3 production build: passed. Eve production compilation: passed.

- Lazy-load the Coder and Research workspace panels with accessible, layout-preserving Suspense fallbacks. Their transcript projections now run only in the active mode instead of scanning every Chat update for both workspaces.
- Preserve memoized historical messages and Markdown, stable interaction callbacks, CSS-based lightweight status motion, and deferred Shiki highlighting.
- Add roving tab focus and Arrow/Home/End keyboard navigation to both specialist workspaces, with regression assertions for selection and actual focus movement. Existing reduced-motion, responsive, touch-target, bilingual, and recovery behavior remains covered by the full suite.
- Keep the real approval and Git-inspection policies directly testable as named exports while their default Eve registrations remain mode-gated. Standardize the affected tests on the repository TSX loader and update the landing-route assertion for validated initial-mode forwarding; no approval or recovery assertion was weakened.
- The production Next build completed its own TypeScript and static/dynamic route generation. The final Eve build also completed; its local DefaultSandbox provider warning remains an environment limitation, not a compilation failure.

Remaining deployed-validation limits:

- No live model/search provider, remote clone, or production sandbox execution was certified by these local checks.
- Vercel auth secrets and trusted deployment hosts were not configured locally; those sign-in paths correctly remained disabled or fail-closed during compilation.
- Non-active conversation mode/history grouping remains browser-local; cross-device restoration of that client metadata was not added.
