"use client";

import { ArrowRightIcon, BookOpenIcon, Code2Icon, LightbulbIcon, PenLineIcon, PlugIcon } from "lucide-react";
import type { ReactNode } from "react";
import { usePromptInputController } from "@/components/ai-elements/prompt-input";
import { getProvider } from "@/lib/providers/catalog";
import { StatusDot } from "./provider-badge";
import { useAppSettings } from "./settings-provider";

const SUGGESTIONS = [
  { key: "suggestion1" as const, icon: BookOpenIcon, label: ["Learn something", "Wax baro"] },
  { key: "suggestion2" as const, icon: PenLineIcon, label: ["Make a plan", "Qorshee"] },
  { key: "suggestion3" as const, icon: Code2Icon, label: ["Work through code", "Xalli koodh"] },
  { key: "suggestion4" as const, icon: LightbulbIcon, label: ["Find the essence", "Soo koob"] },
];

export function EmptyState({
  composer, onOpenSettings, onOpenModels, preparing, preparationError, onRetry,
}: {
  readonly composer: ReactNode;
  readonly onOpenSettings: () => void;
  readonly onOpenModels: () => void;
  readonly preparing: boolean;
  readonly preparationError?: string;
  readonly onRetry: () => void;
}) {
  const { t, selection, isConnected, settings } = useAppSettings();
  const controller = usePromptInputController();
  const provider = getProvider(selection.providerId);
  const connected = isConnected(selection.providerId);
  const so = settings.language === "so";
  const choose = (text: string) => {
    controller.textInput.setInput(text);
    window.setTimeout(() => document.querySelector<HTMLTextAreaElement>('[data-slot="input-group-control"]')?.focus(), 0);
  };

  return (
    <div className="home-content ururka-rise">
      <div className="home-overline"><span><i />{so ? "GOOBTAADA FIKRADAHA" : "YOUR SPACE TO THINK"}</span><span>01 / TFLASH</span></div>
      <div className="home-heading">
        <h1>{so ? "Fikradahaaga" : "Good ideas"}<br /><em>{so ? "halkan ka bilow." : "start here."}</em></h1>
        <p>{so ? "Weydii, qor, qorshee ama wax cusub baro. Maxaan maanta ka shaqaynaynaa?" : "Ask, write, plan or learn something new. What shall we work on today?"}</p>
      </div>
      <div className="home-composer">
        {composer}
        <div className="home-composer-meta">
          <span>{preparationError ? (so ? "Wada hadalka lama diyaarin." : "Couldn’t prepare your conversation.") : preparing ? (so ? "Goobtaada waa la diyaarinayaa…" : "Preparing your workspace…") : (so ? "Enter si aad u dirto · Shift + Enter si aad sadar cusub u bilowdo" : "Enter to send · Shift + Enter for a new line")}</span>
          {preparationError ? <button onClick={onRetry} type="button">{so ? "Mar kale isku day" : "Try again"} <ArrowRightIcon size={13} /></button> : null}
        </div>
      </div>
      <div className="home-suggestions">
        <div className="home-suggestions-heading"><span>{so ? "AMA HALKAN KA BILOW" : "OR START WITH SOMETHING"}</span><span>{so ? "DOORO MID" : "PICK A PROMPT"}</span></div>
        <div className="home-suggestion-grid">
          {SUGGESTIONS.map(({ key, icon: Icon, label }) => (
            <button disabled={preparing} key={key} onClick={() => choose(t(key))} type="button">
              <span className="home-suggestion-icon"><Icon size={17} /></span>
              <span className="home-suggestion-copy"><strong>{label[so ? 1 : 0]}</strong><small>{t(key)}</small></span>
              <ArrowRightIcon className="home-suggestion-arrow" size={15} />
            </button>
          ))}
        </div>
      </div>
      <div className="home-status">
        <button onClick={connected ? onOpenModels : onOpenSettings} type="button"><StatusDot active={connected} /><span>{provider?.name}</span><strong>{connected ? (so ? "Wuu diyaar yahay" : "Ready") : (so ? "Ku xir provider" : "Connect provider")}</strong><ArrowRightIcon size={13} /></button>
        <span className="home-status-note"><PlugIcon size={13} />{so ? "Modelkaaga, doorashadaada." : "Your models, your choice."}</span>
      </div>
    </div>
  );
}
