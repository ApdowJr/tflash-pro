"use client";

import { MicIcon, MicOffIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { PromptInputButton, usePromptInputController } from "@/components/ai-elements/prompt-input";
import { useAppSettings } from "@/components/settings/app-settings";
import type { TranslationKey } from "@/components/settings/i18n";
import { recognitionConstructor, type BrowserRecognition } from "@/lib/browser-speech";

type MicStatus = "idle" | "starting" | "listening" | "stopping";
type RecognitionSession = {
  readonly recognition: BrowserRecognition;
  readonly committed: Set<number>;
  hasFinal: boolean;
};

function recognitionError(error: string): TranslationKey {
  switch (error) {
    case "not-allowed":
    case "service-not-allowed":
      return "voicePermission";
    case "audio-capture":
      return "voiceNoMicrophone";
    case "no-speech":
      return "voiceNoSpeech";
    case "network":
      return "voiceNetwork";
    case "language-not-supported":
      return "voiceLanguageUnsupported";
    default:
      return "voiceInputFailed";
  }
}

/** One-tap dictation. It only edits the draft; it never sends a turn or stores audio. */
export function VoiceInputButton({ disabled }: { readonly disabled: boolean }) {
  const { t } = useAppSettings();
  const { textInput } = usePromptInputController();
  const [status, setStatus] = useState<MicStatus>("idle");
  const [error, setError] = useState<TranslationKey>();
  const active = useRef<RecognitionSession | null>(null);

  const abortActive = useCallback(() => {
    const session = active.current;
    active.current = null;
    if (!session) return;
    const recognition = session.recognition;
    recognition.onstart = null;
    recognition.onresult = null;
    recognition.onerror = null;
    recognition.onend = null;
    try { recognition.abort(); } catch { /* The browser may already have stopped it. */ }
  }, []);

  useEffect(() => () => abortActive(), [abortActive]);
  useEffect(() => {
    if (!disabled || !active.current) return;
    abortActive();
    setStatus("idle");
  }, [disabled, abortActive]);

  function start() {
    if (disabled || active.current) return;
    const Constructor = recognitionConstructor();
    if (!Constructor) {
      setError("voiceInputUnsupported");
      return;
    }
    if (window.isSecureContext === false) {
      setError("voiceSecureRequired");
      return;
    }

    setError(undefined);
    try {
      const recognition = new Constructor();
      const session: RecognitionSession = { recognition, committed: new Set(), hasFinal: false };
      // Web Speech has no standard cross-browser spoken-language auto-detection.
      // An empty lang lets the browser use its configured default language.
      recognition.lang = "";
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.onstart = () => {
        if (active.current === session) setStatus((current) => current === "starting" ? "listening" : current);
      };
      recognition.onresult = (event) => {
        if (active.current !== session) return;
        for (let index = 0; index < event.results.length; index += 1) {
          const result = event.results[index];
          const transcript = result?.[0]?.transcript?.trim();
          if (!transcript || !result.isFinal || session.committed.has(index)) continue;
          session.committed.add(index);
          session.hasFinal = true;
          textInput.append(transcript);
        }
      };
      recognition.onerror = (event) => {
        if (active.current !== session) return;
        abortActive();
        setStatus("idle");
        setError(recognitionError(event.error));
      };
      recognition.onend = () => {
        if (active.current !== session) return;
        active.current = null;
        setStatus("idle");
        if (!session.hasFinal) setError("voiceNoSpeech");
      };
      active.current = session;
      setStatus("starting");
      recognition.start();
    } catch {
      abortActive();
      setStatus("idle");
      setError("voiceInputFailed");
    }
  }

  function stop() {
    const session = active.current;
    if (!session || status === "stopping") return;
    setStatus("stopping");
    try {
      // stop() lets the browser return any final words before ending capture.
      session.recognition.stop();
    } catch {
      abortActive();
      setStatus("idle");
      setError("voiceInputFailed");
    }
  }

  const working = status !== "idle";
  return (
    <>
      <PromptInputButton
        aria-label={t(working ? "voiceStop" : "voiceInput")}
        className={`tf-touch-target absolute right-2 bottom-2 size-8 rounded-full transition-colors sm:right-2.5 sm:bottom-2.5 sm:size-8 ${working ? "bg-destructive text-destructive-foreground" : "bg-primary text-primary-foreground hover:opacity-90"}`}
        disabled={disabled || status === "stopping"}
        onClick={working ? stop : start}
        size="icon-sm"
        tooltip={t(working ? "voiceStop" : "voiceInput")}
        type="button"
      >
        {working ? <MicOffIcon className="size-3.5" /> : <MicIcon className="size-3.5" />}
      </PromptInputButton>
      {error ? (
        <span
          className="absolute right-2 bottom-full mb-2 max-w-[min(22rem,85vw)] rounded-lg border border-destructive/30 bg-card px-3 py-2 text-xs text-destructive shadow-sm"
          role="alert"
        >
          {t(error)}
        </span>
      ) : null}
      {status === "listening" ? <span className="sr-only" role="status">{t("voiceListening")}</span> : null}
      {status === "starting" ? <span className="sr-only" role="status">{t("voiceStarting")}</span> : null}
    </>
  );
}
