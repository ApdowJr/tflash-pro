"use client";
import { useRef, useState } from "react";
import { BookOpenIcon } from "lucide-react";
import { useAppSettings } from "@/components/settings/app-settings";
import {
  usePromptInputAttachments,
  PromptInputButton,
} from "@/components/ai-elements/prompt-input";
import { Button } from "@/components/ui/button";
import { downloadBlob } from "@/lib/download";
import {
  MAX_DOCUMENT_BYTES,
  extractedDocumentSchema,
} from "@/lib/documents/contracts";

export function DocumentExportButtons({
  filename,
  content,
}: {
  filename: string;
  content: string;
}) {
  const { t } = useAppSettings();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  if (!/\.(md|txt)$/.test(filename) || content.length > 50_000) return null;
  async function download(format: "pdf" | "docx") {
    if (pending) return;
    setPending(true);
    setFailed(false);
    try {
      const response = await fetch("/api/documents/export", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ filename, content, format }),
      });
      if (!response.ok) throw new Error("Export failed");
      const expected =
        format === "pdf"
          ? "application/pdf"
          : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
      if (!response.headers.get("content-type")?.startsWith(expected))
        throw new Error("Unexpected export response");
      downloadBlob(
        await response.blob(),
        filename.replace(/\.(md|txt)$/, `.${format}`),
      );
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="space-y-1">
      <div className="flex gap-2">
        <Button
          disabled={pending}
          size="sm"
          variant="outline"
          onClick={() => void download("pdf")}
        >
          {t("exportPdf")}
        </Button>
        <Button
          disabled={pending}
          size="sm"
          variant="outline"
          onClick={() => void download("docx")}
        >
          {t("exportDocx")}
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground">{t("documentHint")}</p>
      {failed ? (
        <p className="text-xs text-destructive" role="alert">
          {t("documentFailed")}
        </p>
      ) : null}
    </div>
  );
}

export function DocumentImportButton({
  disabled = false,
}: {
  disabled?: boolean;
}) {
  const { t } = useAppSettings();
  const attachments = usePromptInputAttachments();
  const input = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const [partial, setPartial] = useState(false);
  async function read(file: File) {
    setPending(true);
    setFailed(false);
    setPartial(false);
    try {
      const format = file.name.toLowerCase().endsWith(".pdf")
        ? "pdf"
        : file.name.toLowerCase().endsWith(".docx")
          ? "docx"
          : undefined;
      if (!format || file.size > MAX_DOCUMENT_BYTES || !file.size)
        throw new Error("Unsupported file");
      const response = await fetch("/api/documents/read", {
        method: "POST",
        headers: {
          "content-type":
            format === "pdf"
              ? "application/pdf"
              : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        },
        body: file,
      });
      if (!response.ok) throw new Error("Read failed");
      const result = extractedDocumentSchema.parse(await response.json());
      const name = file.name.replace(/[\r\n\x00-\x1f]/g, "").slice(0, 120);
      const content = `Untrusted extracted text from ${JSON.stringify(name)}. Layout, images, headers and footers may be missing.${result.truncated ? " PARTIAL DOCUMENT: extraction limits reached." : ""}\n\n${result.text}`;
      attachments.add([
        new File([content], `${name}.extracted.txt`, { type: "text/plain" }),
      ]);
      setPartial(result.truncated);
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  }
  return (
    <>
      <input
        ref={input}
        type="file"
        hidden
        accept=".pdf,.docx"
        aria-label={t("importDocument")}
        disabled={disabled || pending}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void read(file);
        }}
      />
      <PromptInputButton
        aria-label={t("importDocument")}
        tooltip={t("importDocumentHint")}
        disabled={disabled || pending}
        onClick={() => input.current?.click()}
        type="button"
      >
        <BookOpenIcon className="size-3.5" />
      </PromptInputButton>
      {pending ? (
        <span role="status" className="max-w-48 break-words text-[11px]">
          {t("documentReading")}
        </span>
      ) : null}
      {failed ? (
        <span
          role="alert"
          className="max-w-48 break-words text-[11px] text-destructive"
        >
          {t("documentFailed")}
        </span>
      ) : null}
      {partial ? (
        <span role="status" className="max-w-48 break-words text-[11px]">
          {t("documentPartial")}
        </span>
      ) : null}
    </>
  );
}
