import { z } from "zod";
export const MAX_DOCUMENT_BYTES = 2 * 1024 * 1024;
export const documentExportSchema = z
  .object({
    format: z.enum(["pdf", "docx"]),
    filename: z
      .string()
      .max(100)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._ -]*\.(md|txt)$/),
    content: z.string().min(1).max(50_000),
  })
  .strict();
export const extractedDocumentSchema = z.object({
  text: z.string().min(1).max(100_000),
  truncated: z.boolean(),
  pages: z.number().int().positive().optional(),
});

/** Only decode bounded composer-generated text data URLs, never fetch a URL. */
export function attachedText(url: string): string | undefined {
  const match =
    /^data:text\/(?:plain|markdown)(?:;charset=[^;,]+)?;base64,([A-Za-z0-9+/=]+)$/.exec(
      url,
    );
  if (!match || match[1].length > 600_000) return undefined;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(
      Uint8Array.from(atob(match[1]), (char) => char.charCodeAt(0)),
    );
  } catch {
    return undefined;
  }
}
