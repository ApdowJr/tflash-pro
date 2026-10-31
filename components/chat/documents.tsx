"use client";
import { useEffect, useRef, useState } from "react";
import { fetchDocumentResponse, readDocumentBlob, readDocumentResult } from "@/lib/documents/client-fetch";
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
  const { t, accountId, accountKind } = useAppSettings();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const operation = useRef<AbortController | null>(null);
  const scope = useRef({ accountId, accountKind, filename, content });
  scope.current = { accountId, accountKind, filename, content };
  useEffect(() => {
    setPending(false);
    setFailed(false);
    return () => { operation.current?.abort(); operation.current = null; };
  }, [accountId, accountKind, filename, content]);
  if (!/\.(md|txt)$/.test(filename) || content.length > 50_000) return null;
  async function download(format: "pdf" | "docx") {
    if (operation.current) return;
    const controller = new AbortController();
    operation.current = controller;
    const current = () => operation.current === controller && !controller.signal.aborted &&
      scope.current.accountId === accountId && scope.current.accountKind === accountKind &&
      scope.current.filename === filename && scope.current.content === content;
    setPending(true);
    setFailed(false);
    try {
      const { response, signal } = await fetchDocumentResponse("/api/documents/export", {
        method: "POST", signal: controller.signal,
        headers: { "content-type": "application/json", "x-tflash-expected-user-id": accountId, "x-tflash-expected-account-kind": accountKind },
        body: JSON.stringify({ filename, content, format }),
      });
      const expected = format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
      const blob = await readDocumentBlob(response, signal, expected);
      if (current()) downloadBlob(blob, filename.replace(/\.(md|txt)$/, `.${format}`));
    } catch {
      if (current()) setFailed(true);
    } finally {
      if (current()) { operation.current = null; setPending(false); }
    }
  }
  return (
    <div className="space-y-1">
      <div className="flex gap-2">
        <Button
          className="tf-touch-target min-h-11"
          disabled={pending}
          size="sm"
          variant="outline"
          onClick={() => void download("pdf")}
        >
          {t("exportPdf")}
        </Button>
        <Button
          className="tf-touch-target min-h-11"
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
  onPendingChange,
}: {
  disabled?: boolean;
  onPendingChange?: (pending: boolean) => void;
}) {
  const { t, accountId, accountKind } = useAppSettings();
  const attachments = usePromptInputAttachments();
  const input = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const [partial, setPartial] = useState(false);
  useEffect(() => { onPendingChange?.(pending); return () => onPendingChange?.(false); }, [pending, onPendingChange]);
  const operation = useRef<AbortController | null>(null);
  const identity = `${accountKind}:${accountId}`;
  const currentIdentity = useRef(identity);
  currentIdentity.current = identity;
  useEffect(() => {
    setPending(false); setFailed(false); setPartial(false);
    return () => { operation.current?.abort(); operation.current = null; };
  }, [identity]);
  async function read(file: File) {
    if (operation.current) return;
    const controller = new AbortController();
    operation.current = controller;
    const current = () => operation.current === controller && !controller.signal.aborted && currentIdentity.current === identity;
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
      const { response, signal } = await fetchDocumentResponse("/api/documents/read", {
        method: "POST", signal: controller.signal,
        headers: {
          "x-tflash-expected-user-id": accountId,
          "x-tflash-expected-account-kind": accountKind,
          "content-type":
            format === "pdf"
              ? "application/pdf"
              : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        },
        body: file,
      });
      const result = extractedDocumentSchema.parse(await readDocumentResult(response, signal));
      if (!current()) return;
      const name = file.name.replace(/[\r\n\x00-\x1f]/g, "").slice(0, 120);
      const content = `Untrusted extracted text from ${JSON.stringify(name)}. Layout, images, headers and footers may be missing.${result.truncated ? " PARTIAL DOCUMENT: extraction limits reached." : ""}\n\n${result.text}`;
      attachments.add([
        new File([content], `${name}.extracted.txt`, { type: "text/plain" }),
      ]);
      setPartial(result.truncated);
    } catch {
      if (current()) setFailed(true);
    } finally {
      if (current()) { operation.current = null; setPending(false); }
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
        className="tf-touch-target size-11 min-h-11 min-w-11 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        aria-label={t("importDocument")}
        tooltip={t("importDocumentHint")}
        disabled={disabled || pending}
        onClick={() => input.current?.click()}
        type="button"
      >
        <BookOpenIcon className="size-4" />
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
