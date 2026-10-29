import type { Language } from "@/components/settings/i18n";

/** Minimal Web Speech types; speech recognition is not in TypeScript's DOM lib. */
export type RecognitionResultEvent = {
  readonly results: ArrayLike<{
    readonly isFinal: boolean;
    readonly 0?: { readonly transcript?: string };
  }>;
};

export type RecognitionErrorEvent = { readonly error: string };

export type BrowserRecognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onstart: (() => void) | null;
  onresult: ((event: RecognitionResultEvent) => void) | null;
  onerror: ((event: RecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

type RecognitionConstructor = new () => BrowserRecognition;

export function recognitionConstructor(): RecognitionConstructor | undefined {
  if (typeof window === "undefined") return undefined;
  const browser = window as typeof window & {
    SpeechRecognition?: RecognitionConstructor;
    webkitSpeechRecognition?: RecognitionConstructor;
  };
  return browser.SpeechRecognition ?? browser.webkitSpeechRecognition;
}

export function speechLocale(language: Language): string {
  return language === "so" ? "so-SO" : "en-US";
}

/** Never silently substitute an English voice for a requested Somali voice. */
export function voiceMatchesLanguage(voice: Pick<SpeechSynthesisVoice, "lang">, language: Language): boolean {
  return voice.lang.toLowerCase().replaceAll("_", "-").split("-")[0] === language;
}

/** Small utterances avoid browser engines' length limits. No content is omitted. */
export function splitSpeechText(text: string, maxChars = 1200): string[] {
  const size = Number.isFinite(maxChars) ? Math.max(2, Math.floor(maxChars)) : 1200;
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    while (start < text.length && /\s/u.test(text[start]!)) start += 1;
    if (start >= text.length) break;
    let end = Math.min(start + size, text.length);
    if (end < text.length) {
      const segment = text.slice(start, end);
      const breakAt = Math.max(segment.lastIndexOf("\n"), segment.lastIndexOf(" "));
      if (breakAt >= size / 3) end = start + breakAt;
      // Do not divide a UTF-16 surrogate pair when a long word has no spaces.
      else if (/^[\uD800-\uDBFF]$/.test(text[end - 1]!)) end -= 1;
    }
    const chunk = text.slice(start, end).trim();
    if (chunk) chunks.push(chunk);
    start = end;
  }
  return chunks;
}
