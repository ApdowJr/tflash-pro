import { Worker } from "node:worker_threads";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { Document, Packer, Paragraph, TextRun } from "docx";

import {
  MAX_DOCUMENT_BYTES,
  documentExportSchema,
  extractedDocumentSchema,
} from "./contracts";
export {
  MAX_DOCUMENT_BYTES,
  documentExportSchema,
  extractedDocumentSchema,
} from "./contracts";
export async function boundedBody(
  request: Request,
  max: number,
): Promise<Uint8Array> {
  if (Number(request.headers.get("content-length")) > max)
    throw new Error("Document too large.");
  if (!request.body) throw new Error("Empty body.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) {
        await reader.cancel();
        throw new Error("Document too large.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const all = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    all.set(chunk, offset);
    offset += chunk.length;
  }
  return all;
}
let activeReaders = 0;
export async function extractDocument(
  bytes: Uint8Array,
  format: "pdf" | "docx",
) {
  if (!bytes.length || bytes.length > MAX_DOCUMENT_BYTES)
    throw new Error("Document too large or empty.");
  const prefix = Buffer.from(bytes.subarray(0, 5)).toString("ascii");
  if (format === "pdf" ? prefix !== "%PDF-" : !prefix.startsWith("PK"))
    throw new Error("File content does not match its format.");
  if (activeReaders >= 2)
    throw new Error("Document processors are busy. Try again shortly.");
  activeReaders++;
  return new Promise<z.infer<typeof extractedDocumentSchema>>(
    (resolve, reject) => {
      const worker = new Worker(
        path.join(process.cwd(), "lib/documents/parse-worker.mjs"),
        {
          execArgv: [],
          workerData: { bytes, format },
          resourceLimits: {
            maxOldGenerationSizeMb: 128,
            maxYoungGenerationSizeMb: 16,
            stackSizeMb: 4,
          },
        },
      );
      const timer = setTimeout(() => {
        void worker.terminate();
        reject(new Error("Document processing timed out."));
      }, 12_000);
      worker.once("message", (result) => {
        clearTimeout(timer);
        void worker.terminate();
        const parsed = extractedDocumentSchema.safeParse(result);
        if (result?.ok && parsed.success) resolve(parsed.data);
        else
          reject(
            new Error(
              "Document could not be read. Scanned/encrypted PDFs and unsafe DOCX files are not supported.",
            ),
          );
      });
      worker.once("error", () => {
        clearTimeout(timer);
        reject(new Error("Document processor unavailable."));
      });
      worker.once("exit", () => {
        clearTimeout(timer);
        reject(
          new Error("Document processor stopped before returning a result."),
        );
      });
    },
  ).finally(() => {
    activeReaders--;
  });
}

export async function exportDocument(
  input: z.infer<typeof documentExportSchema>,
): Promise<Uint8Array> {
  const { content, format } = documentExportSchema.parse(input);
  if (content.split(/\r?\n/).length > 2000)
    throw new Error("Document exceeds the 2,000 line limit.");
  if (format === "docx") {
    const document = new Document({
      sections: [
        {
          children: content
            .split(/\r?\n/)
            .map(
              (text) => new Paragraph({ children: [new TextRun({ text })] }),
            ),
        },
      ],
    });
    return new Uint8Array(await Packer.toBuffer(document));
  }
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(
    await readFile(
      path.join(process.cwd(), "assets/fonts/NotoSans-Regular.ttf"),
    ),
    { subset: true },
  );
  // Fail instead of silently replacing unsupported scripts/glyphs.
  const supported = new Set(font.getCharacterSet());
  if (
    [...content].some(
      (c) => !/[\r\n\t]/.test(c) && !supported.has(c.codePointAt(0)!),
    )
  )
    throw new Error(
      "This PDF font cannot represent one or more characters. Download DOCX or the original text instead.",
    );
  const width = 499,
    size = 11,
    lineHeight = 16;
  let page = pdf.addPage([595, 842]),
    y = 795;
  const line = (text: string) => {
    if (y < 48) {
      if (pdf.getPageCount() >= 100) throw new Error("PDF exceeds page limit.");
      page = pdf.addPage([595, 842]);
      y = 795;
    }
    page.drawText(text, { x: 48, y, size, font, color: rgb(0.08, 0.08, 0.08) });
    y -= lineHeight;
  };
  for (const paragraph of content.replace(/\t/g, "    ").split(/\r?\n/)) {
    let current = "";
    for (const char of paragraph) {
      if (font.widthOfTextAtSize(current + char, size) > width) {
        line(current);
        current = "";
      }
      current += char;
    }
    line(current);
  }
  return pdf.save();
}
