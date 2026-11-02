"use client";

import { BracesIcon, FileSearchIcon, FolderIcon, MessageSquareTextIcon, ArrowUpRightIcon } from "lucide-react";
import { FlashMark } from "@/components/brand/logo";
import { useAppSettings } from "@/components/settings/app-settings";
import { usePromptInputController } from "@/components/ai-elements/prompt-input";
import { useWorkspace } from "@/components/settings/workspace-store";
import { AGENT_MODES, type AgentMode } from "@/lib/agent-modes";

const MODE_ICONS = {
  chat: MessageSquareTextIcon,
  coder: BracesIcon,
  research: FileSearchIcon,
} as const;

const MODE_PROMPTS = {
  chat: "suggestion1",
  coder: "suggestion3",
  research: "suggestion4",
} as const;

/** A personalized launch surface built only from the signed-in user's real account and workspace. */
export function EmptyState({
  name,
  mode,
  onModeChange,
  onOpenProjects,
}: {
  readonly name: string;
  readonly mode: AgentMode;
  readonly onModeChange: (mode: AgentMode) => void;
  readonly onOpenProjects: () => void;
}) {
  const { t, settings } = useAppSettings();
  const controller = usePromptInputController();
  const { workspace, ready } = useWorkspace();

  const selectMode = (nextMode: AgentMode) => {
    onModeChange(nextMode);
    controller.textInput.append(t(MODE_PROMPTS[nextMode]));
    window.setTimeout(() => {
      document.querySelector<HTMLTextAreaElement>('[data-slot="input-group-control"]')?.focus();
    }, 0);
  };

  return (
    <div className="tf-rise mx-auto flex w-full max-w-4xl flex-col px-4 pt-[clamp(2.25rem,8vh,6rem)] pb-8 sm:px-6">
      <header className="mb-8 flex flex-col items-center text-center">
        <div className="mb-4 rounded-[18px] bg-violet-500/10 p-2 ring-1 ring-violet-300/15 shadow-[0_12px_42px_-20px_rgba(124,58,237,0.65)]">
          <FlashMark className="size-11 rounded-xl" />
        </div>
        <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-violet-200/70">Tflash</p>
        <h1 className="mt-4 max-w-full text-balance text-[clamp(1.8rem,4vw,3.15rem)] font-semibold leading-[1.12] tracking-[-0.045em] text-white">
          {t("greeting")} <span className="bg-gradient-to-r from-violet-300 via-fuchsia-300 to-violet-200 bg-clip-text text-transparent">{name}</span>
        </h1>
        <p className="mt-3 text-pretty text-[clamp(1.05rem,2vw,1.45rem)] font-medium tracking-[-0.025em] text-white/80">{t("welcome")}</p>
        <p className="mt-2 max-w-lg text-[13px] leading-relaxed text-white/50">{t("subtitle")}</p>
      </header>

      <section aria-label={settings.language === "so" ? "Dooro habka shaqada" : "Choose a way to work"} className="mx-auto w-full max-w-3xl">
        <div className="mb-3 flex items-center justify-between gap-3 px-1">
          <h2 className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/45">{t("startWith")}</h2>
          <p className="text-[10px] text-white/35">{t("suggestionHint")}</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {AGENT_MODES.map((item) => {
            const Icon = MODE_ICONS[item.id];
            const selected = mode === item.id;
            return (
              <button
                aria-pressed={selected}
                className={`group flex min-h-[88px] items-center gap-4 rounded-2xl border px-4 py-4 text-left transition duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300/70 focus-visible:ring-offset-2 focus-visible:ring-offset-background ${selected ? "border-violet-400/35 bg-violet-500/[0.12] shadow-[0_12px_38px_-24px_rgba(139,92,246,0.6)]" : "border-white/[0.09] bg-white/[0.035] hover:border-violet-300/25 hover:bg-white/[0.06]"}`}
                key={item.id}
                onClick={() => selectMode(item.id)}
                title={item.hint[settings.language]}
                type="button"
              >
                <span className={`flex size-12 shrink-0 items-center justify-center rounded-[15px] border border-violet-300/15 bg-gradient-to-br from-violet-600/35 to-fuchsia-700/15 text-violet-100 shadow-inner transition-colors ${selected ? "from-violet-500/45 to-fuchsia-600/25" : "group-hover:from-violet-500/40"}`}>
                  <Icon aria-hidden="true" className="size-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] font-semibold text-white">{item.label[settings.language]}</span>
                  <span className="mt-1 block text-[12px] leading-relaxed text-white/55">{t(MODE_PROMPTS[item.id])}</span>
                </span>
                <ArrowUpRightIcon aria-hidden="true" className="size-4 shrink-0 text-white/35 transition-all group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-violet-200" />
              </button>
            );
          })}

          <button
            aria-label={`${t("projects")}${ready && workspace.projects.length ? ` (${workspace.projects.length})` : ""}`}
            className="group flex min-h-[88px] items-center gap-4 rounded-2xl border border-white/[0.09] bg-white/[0.035] px-4 py-4 text-left transition duration-150 hover:border-violet-300/25 hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300/70 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            onClick={onOpenProjects}
            type="button"
          >
            <span className="flex size-12 shrink-0 items-center justify-center rounded-[15px] border border-violet-300/15 bg-gradient-to-br from-violet-600/35 to-fuchsia-700/15 text-violet-100 shadow-inner">
              <FolderIcon aria-hidden="true" className="size-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2 text-[14px] font-semibold text-white">
                {t("projects")}
                {ready && workspace.projects.length > 0 ? <span className="rounded-full bg-violet-300/10 px-2 py-0.5 text-[10px] font-medium text-violet-100/80">{workspace.projects.length}</span> : null}
              </span>
              <span className="mt-1 block text-[12px] leading-relaxed text-white/55">{t("projectTileHint")}</span>
            </span>
            <ArrowUpRightIcon aria-hidden="true" className="size-4 shrink-0 text-white/35 transition-all group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-violet-200" />
          </button>
        </div>
      </section>
    </div>
  );
}
