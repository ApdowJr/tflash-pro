"use client";

import { Volume2Icon } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useAppSettings } from "@/components/settings/app-settings";
import type { Language } from "@/components/settings/i18n";
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
import { splitSpeechText, voiceMatchesLanguage } from "@/lib/browser-speech";
import { VoiceLanguageSelect } from "./voice-language";

type Playback = { readonly engine: SpeechSynthesis };

function supported(): boolean {
  return typeof window !== "undefined" &&
    typeof window.speechSynthesis?.getVoices === "function" &&
    typeof window.SpeechSynthesisUtterance === "function";
}

/** Plays only the selected assistant message's text, on an explicit click. */
export function VoiceOutputButton({ text, disabled = false }: { readonly text: string; readonly disabled?: boolean }) {
  const { t, settings } = useAppSettings();
  const voiceId = useId();
  const [open, setOpen] = useState(false);
  const [available, setAvailable] = useState(false);
  const [language, setLanguage] = useState<Language>(settings.language);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedUri, setSelectedUri] = useState("");
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);
  const active = useRef<Playback | null>(null);
  const utterance = useRef<SpeechSynthesisUtterance | null>(null);

  const stop = useCallback((updateState = true) => {
    const playback = active.current;
    // Invalidate before cancel(): browsers may synchronously emit an error/end.
    active.current = null;
    utterance.current = null;
    if (playback) {
      try { playback.engine.cancel(); } catch { /* The engine may already be gone. */ }
    }
    if (updateState) setPlaying(false);
  }, []);

  useEffect(() => () => stop(false), [stop]);
  useEffect(() => {
    if (disabled && active.current) stop();
  }, [disabled, stop]);
  useEffect(() => {
    if (!open || !available) return;
    const engine = window.speechSynthesis;
    const update = () => {
      try { setVoices(engine.getVoices()); }
      catch { setVoices([]); }
    };
    update();
    engine.addEventListener("voiceschanged", update);
    return () => engine.removeEventListener("voiceschanged", update);
  }, [open, available]);

  function refreshVoices() {
    if (!supported()) { setAvailable(false); return; }
    try { setVoices(window.speechSynthesis.getVoices()); }
    catch { setVoices([]); }
  }

  function changeOpen(next: boolean) {
    if (next) {
      setAvailable(supported());
      setVoices([]);
      setLanguage(settings.language);
      setSelectedUri("");
      setFailed(false);
    } else {
      stop();
    }
    setOpen(next);
  }

  const matching = voices.filter((voice) => voiceMatchesLanguage(voice, language));
  const selected = matching.find((voice) => voice.voiceURI === selectedUri) ?? matching[0];

  function play() {
    if (!selected || !supported() || active.current || disabled) return;
    const chunks = splitSpeechText(text);
    if (chunks.length === 0) return;
    const engine = window.speechSynthesis;
    const playback: Playback = { engine };
    active.current = playback;
    setFailed(false);
    setPlaying(true);
    let index = 0;
    const next = () => {
      if (active.current !== playback) return;
      if (index >= chunks.length) {
        active.current = null;
        utterance.current = null;
        setPlaying(false);
        return;
      }
      try {
        const current = new window.SpeechSynthesisUtterance(chunks[index++]!);
        current.lang = selected.lang;
        current.voice = selected;
        current.onend = next;
        current.onerror = () => {
          if (active.current !== playback) return;
          active.current = null;
          utterance.current = null;
          setPlaying(false);
          setFailed(true);
        };
        // Retain the utterance until its event fires; some browsers require it.
        utterance.current = current;
        engine.speak(current);
      } catch {
        if (active.current !== playback) return;
        active.current = null;
        utterance.current = null;
        setPlaying(false);
        setFailed(true);
      }
    };
    next();
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild>
        <Button
          aria-label={t("voiceListen")}
          className="tf-touch-target h-6 gap-1 rounded-md px-1.5 text-[10.5px] text-muted-foreground"
          disabled={disabled || !text.trim()}
          size="sm"
          type="button"
          variant="ghost"
        >
          <Volume2Icon className="size-3" />{t("voiceListen")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md" closeLabel={t("dismiss")}>
        <DialogHeader>
          <DialogTitle>{t("voiceOutputTitle")}</DialogTitle>
          <DialogDescription>{t("voiceOutputHint")}</DialogDescription>
        </DialogHeader>
        <VoiceLanguageSelect value={language} onChange={(value) => { setLanguage(value); setSelectedUri(""); }} disabled={playing} />
        {available ? (
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor={voiceId}>{t("voiceChoice")}</label>
            <select
              className="min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm disabled:opacity-50"
              disabled={playing || matching.length === 0}
              id={voiceId}
              onChange={(event) => setSelectedUri(event.target.value)}
              value={selected?.voiceURI ?? ""}
            >
              {matching.length === 0 ? <option value="">—</option> : matching.map((voice, index) => (
                <option key={`${voice.voiceURI}-${index}`} value={voice.voiceURI}>{voice.name} ({voice.lang})</option>
              ))}
            </select>
            {matching.length === 0 ? (
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>{t("voiceNoVoices")}</p>
                <Button className="min-h-11" onClick={refreshVoices} size="sm" type="button" variant="outline">{t("voiceRefresh")}</Button>
              </div>
            ) : null}
          </div>
        ) : <p className="text-sm text-muted-foreground">{t("voiceOutputUnsupported")}</p>}
        {playing ? <p className="text-sm text-muted-foreground" role="status">{t("voicePlaying")}</p> : null}
        {failed ? <p className="rounded-md border border-destructive/30 px-3 py-2 text-sm text-destructive" role="alert">{t("voicePlaybackFailed")}</p> : null}
        <DialogFooter>
          <Button className="min-h-11" onClick={() => changeOpen(false)} type="button" variant="outline">{t("voiceDone")}</Button>
          {playing ? (
            <Button className="min-h-11" onClick={() => stop()} type="button" variant="secondary">{t("voiceStopPlayback")}</Button>
          ) : (
            <Button className="min-h-11" disabled={!available || !selected || disabled} onClick={play} type="button">
              <Volume2Icon className="size-4" />{t("voicePlay")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
