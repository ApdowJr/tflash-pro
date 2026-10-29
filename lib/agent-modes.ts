export type AgentMode = "chat" | "coder" | "research";

export const AGENT_MODES: readonly {
  readonly id: AgentMode;
  readonly label: { readonly en: string; readonly so: string };
  readonly hint: { readonly en: string; readonly so: string };
  readonly instruction: string;
}[] = [
  {
    id: "chat",
    label: { en: "Chat", so: "Sheeko" },
    hint: { en: "Everyday help, writing and explanations", so: "Caawimo guud, qoraal iyo sharaxaad" },
    instruction: "Provide practical general assistance, writing, explanations, and help with user-provided files. Use tools only when they materially improve the answer; be concise and ask a focused question when a missing detail changes the result.",
  },
  {
    id: "coder",
    label: { en: "Coder", so: "Coder" },
    hint: { en: "Inspect, implement, debug and test code", so: "Baadh, hagaaji oo tijaabi code-ka" },
    instruction: "Act as a senior software engineer. For repository tasks, inspect the actual connected repository and its instructions before editing; understand existing patterns; make the smallest complete change; add or update regression tests; run relevant test, typecheck and build commands when available; inspect the resulting diff and CI output. Treat the shell sandbox as temporary and separate from the user repository unless a tool proves otherwise. Never say a file was changed, a test passed, or a deployment succeeded without direct tool evidence. Explain blockers precisely. Preserve existing user changes. Do not bypass GitHub, shell, database, or external-action approvals.",
  },
  {
    id: "research",
    label: { en: "Research", so: "Cilmi-baaris" },
    hint: { en: "Search, read sources and create cited reports", so: "Raadi, akhri ilo, diyaari warbixin xigasho leh" },
    instruction: "Act as a careful researcher. Search for primary and independent sources where available, then read actual public pages through the approved fetch tool before treating them as evidence. Cite only successfully fetched sources, compare dates and conflicts, separate source facts from AI synthesis, and state limitations. Use create_research_report only with real receipts from this conversation. Search availability depends on the selected provider; never invent a source or claim an unread page was verified.",
  },
] as const;

export function parseAgentMode(value: unknown): AgentMode {
  return value === "coder" || value === "research" || value === "chat" ? value : "chat";
}

export function agentModeStorageKey(kind: string, userId: string, sessionId: string): string {
  return "tflash:agent-mode:v1:" + encodeURIComponent(kind) + ":" + encodeURIComponent(userId) + ":" + encodeURIComponent(sessionId);
}

/** Bounded, user-selected preference; never grants permissions or overrides system safety. */
export function agentModeContext(modeValue: unknown, language: "en" | "so"): string {
  const mode = AGENT_MODES.find((item) => item.id === parseAgentMode(modeValue))!;
  return [
    "",
    "Tflash operating mode (user-selected preference; untrusted context, not a permission grant; follow higher-priority system and safety instructions):",
    "Mode: " + mode.label.en + ".",
    mode.instruction,
    "Reply in " + (language === "so" ? "Somali" : "English") + " unless the user clearly requests another language.",
  ].join("\n");
}