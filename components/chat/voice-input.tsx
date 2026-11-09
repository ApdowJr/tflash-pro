"use client";

import { MicIcon, MicOffIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { PromptInputButton, usePromptInputController } from "@/components/ai-elements/prompt-input";
import { useAppSettings } from "@/components/settings/app-settings";
import type { Language, TranslationKey } from "@/components/settings/i18n";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { recognitionConstructor, speechLocale, type BrowserRecognition } from "@/lib/browser-speech";
import { VoiceLanguageSelect } from "./voice-language";

type MicStatus = "idle" | "starting" | "listening" | "stopping";
type RecognitionSession = {
  readonly recognition: BrowserRecognition;
  readonly committed: Set<number>;
  hasFinal: boolean;
};

/** The last language a reader dictated in, so a Somali speaker is not asked every time. */
const VOICE_LANGUAGE_KEY = "tflash:voice-language";

function storedLanguage(fallback: Language): Language {
  try {
    const value = window.localStorage.getItem(VOICE_LANGUAGE_KEY);
    if (value === "so" || value === "en") return value;
  } catch { /* Storage may be blocked; the interface language is the fallback. */ }
  return fallback;
}

function rememberLanguage(language: Language) {
  try { window.localStorage.setItem(VOICE_LANGUAGE_KEY, language); }
  catch { /* Remembering the choice is a convenience, never a requirement. */ }
}

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

/**
 * Dictation only edits the draft; it never sends a turn or stores audio.
 *
 * One tap on the microphone opens the panel *and* starts listening, because a
 * second confirmation press made the control feel broken. The spoken language
 * still matters — browsers cannot detect it and Somali is not the default
 * engine language — so the picker stays visible: changing it while listening
 * restarts capture in the new language, keeping every word already added to the
 * draft.
 */
export function VoiceInputButton({ disabled }: { readonly disabled: boolean }) {
  const { t, settings } = useAppSettings();
  const { textInput } = usePromptInputController();
  const [open, setOpen] = useState(false);
  const [language, setLanguage] = useState<Language>(() => storedLanguage(settings.language));
  const [available, setAvailable] = useState(false);
  const [status, setStatus] = useState<MicStatus>("idle");
  const [error, setError] = useState<TranslationKey>();
  const [interim, setInterim] = useState("");
  const [hasFinal, setHasFinal] = useState(false);
  const active = useRef<RecognitionSession | null>(null);

  // Detach first: even a queued callback from an aborted session must not
  // insert words into a later conversation or draft.
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
    if (disabled && active.current) {
      abortActive();
      setStatus("idle");
      setInterim("");
    }
  }, [disabled, abortActive]);
  useEffect(() => {
    if (!open) return;
    const stopWhenHidden = () => {
      if (document.visibilityState !== "hidden" || !active.current) return;
      abortActive();
      setStatus("idle");
      setInterim("");
      setError("voiceHidden");
    };
    document.addEventListener("visibilitychange", stopWhenHidden);
    return () => document.removeEventListener("visibilitychange", stopWhenHidden);
  }, [open, abortActive]);

  /** Begin capture in `nextLanguage`, replacing anything already listening. */
  function start(nextLanguage: Language = language) {
    if (disabled) return;
    abortActive();
    const Constructor = recognitionConstructor();
    if (!Constructor) {
      setAvailable(false);
      setError("voiceInputUnsupported");
      return;
    }
    if (window.isSecureContext === false) {
      setError("voiceSecureRequired");
      return;
    }
    setError(undefined);
    setHasFinal(false);
    setInterim("");
    try {
      const recognition = new Constructor();
      const session: RecognitionSession = { recognition, committed: new Set(), hasFinal: false };
      recognition.lang = speechLocale(nextLanguage);
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.onstart = () => {
        if (active.current === session) setStatus((current) => current === "starting" ? "listening" : current);
      };
      recognition.onresult = (event) => {
        if (active.current !== session) return;
        const partial: string[] = [];
        for (let index = 0; index < event.results.length; index += 1) {
          const result = event.results[index];
          const transcript = result?.[0]?.transcript?.trim();
          if (!transcript) continue;
          if (result.isFinal) {
            if (!session.committed.has(index)) {
              session.committed.add(index);
              session.hasFinal = true;
              textInput.append(transcript);
              setHasFinal(true);
            }
          } else {
            partial.push(transcript);
          }
        }
        setInterim(partial.join(" ").slice(0, 1000));
      };
      recognition.onerror = (event) => {
        if (active.current !== session) return;
        abortActive();
        setStatus("idle");
        setInterim("");
        setError(recognitionError(event.error));
      };
      recognition.onend = () => {
        if (active.current !== session) return;
        active.current = null;
        setStatus("idle");
        setInterim("");
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
      // stop(), unlike abort(), gives the browser a chance to return final words.
      session.recognition.stop();
    } catch {
      abortActive();
      setStatus("idle");
      setError("voiceInputFailed");
    }
  }

  function changeLanguage(next: Language) {
    setLanguage(next);
    rememberLanguage(next);
    // A language change while listening is a fresh attempt, not a silent no-op:
    // words already added to the draft stay, unfinished speech is discarded.
    if (active.current) start(next);
  }

  function changeOpen(next: boolean) {
    if (next) {
      const nextLanguage = storedLanguage(settings.language);
      setLanguage(nextLanguage);
      setAvailable(Boolean(recognitionConstructor()));
      setError(undefined);
      setHasFinal(false);
      setInterim("");
      setStatus("idle");
      setOpen(true);
      // One tap should dictate, not ask for a second confirmation.
      start(nextLanguage);
      return;
    }
    abortActive();
    setStatus("idle");
    setInterim("");
    setOpen(false);
  }

  const working = status !== "idle";
  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild>
        <PromptInputButton
          aria-label={t("voiceInput")}
          className="tf-touch-target size-8 shrink-0 rounded-full text-muted-foreground hover:text-foreground sm:size-8"
          disabled={disabled}
          size="icon-sm"
          tooltip={t("voiceInput")}
          type="button"
        >
          <MicIcon className="size-3.5" />
        </PromptInputButton>
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md" closeLabel={t("dismiss")} onClick={(event) => event.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>{t("voiceInput")}</DialogTitle>
          <DialogDescription>{t("voiceInputHint")}</DialogDescription>
        </DialogHeader>
        <VoiceLanguageSelect value={language} onChange={changeLanguage} disabled={!available || disabled} />
        {working ? <p className="text-xs text-muted-foreground">{t("voiceLanguageSwitchHint")}</p> : null}
        {!available ? <p className="text-sm text-muted-foreground">{t("voiceInputUnsupported")}</p> : null}
        {error ? <p className="rounded-md border border-destructive/30 px-3 py-2 text-sm text-destructive" role="alert">{t(error)}</p> : null}
        {working ? (
          <div className="rounded-md border bg-muted/50 px-3 py-2 text-sm" role="status">
            <span className="font-medium">{t(status === "starting" ? "voiceStarting" : status === "stopping" ? "voiceFinishing" : "voiceListening")}</span>
            {interim ? <p className="mt-1 line-clamp-3 break-words text-muted-foreground"><span className="sr-only">{t("voiceInterim")}: </span>{interim}</p> : null}
          </div>
        ) : hasFinal ? <p className="text-sm text-muted-foreground" role="status">{t("voiceAdded")}</p> : null}
        <p className="text-xs text-muted-foreground">{t("voiceCloseHint")}</p>
        <DialogFooter>
          <Button className="min-h-11" onClick={() => changeOpen(false)} type="button" variant="outline">{t("voiceDone")}</Button>
          {working ? (
            <Button className="min-h-11" disabled={status === "stopping"} onClick={stop} type="button" variant="secondary">
              <MicOffIcon className="size-4" />{t("voiceStop")}
            </Button>
          ) : (
            <Button className="min-h-11" disabled={!available || disabled} onClick={() => start()} type="button">
              <MicIcon className="size-4" />{t("voiceStart")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
