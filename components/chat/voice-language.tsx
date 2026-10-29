"use client";

import { useId } from "react";
import { useAppSettings } from "@/components/settings/app-settings";
import type { Language } from "@/components/settings/i18n";

export function VoiceLanguageSelect({
  value,
  onChange,
  disabled = false,
}: {
  readonly value: Language;
  readonly onChange: (language: Language) => void;
  readonly disabled?: boolean;
}) {
  const id = useId();
  const { t } = useAppSettings();
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium" htmlFor={id}>{t("voiceLanguage")}</label>
      <select
        className="min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm disabled:opacity-50"
        disabled={disabled}
        id={id}
        onChange={(event) => onChange(event.target.value === "so" ? "so" : "en")}
        value={value}
      >
        <option value="so">{t("voiceSomali")}</option>
        <option value="en">{t("voiceEnglish")}</option>
      </select>
    </div>
  );
}
