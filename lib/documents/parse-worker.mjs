// Runs outside the web request thread. No URLs, macros, images or external
// relationships are followed. The caller terminates this worker on timeout.
import { parentPort, workerData } from "node:worker_threads";
import yauzl from "yauzl";
import { createRequire } from "node:module";
import path from "node:path";
import { SaxesParser } from "saxes";

const MAX_TEXT = 100_000;
async function readDocx(buffer) {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(
      buffer,
      { lazyEntries: true, validateEntrySizes: true, strictFileNames: true },
      (error, zip) => {
        if (error || !zip) return reject(new Error("Invalid DOCX archive."));
        let entries = 0,
          totalSize = 0,
          found = false;
        const fail = (error) => {
          zip.close();
          reject(error);
        };
        zip.on("error", fail);
        zip.on("entry", (entry) => {
          if (
            ++entries > 256 ||
            (totalSize += entry.uncompressedSize) > 20 * 1024 * 1024 ||
            entry.generalPurposeBitFlag & 1
          )
            return fail(new Error("DOCX exceeds safe archive limits."));
          if (entry.fileName !== "word/document.xml") return zip.readEntry();
          if (found || entry.uncompressedSize > 1024 * 1024)
            return fail(
              new Error("DOCX document part is too large or duplicated."),
            );
          found = true;
          zip.openReadStream(entry, (error, stream) => {
            if (error || !stream) return fail(new Error("Unreadable DOCX."));
            let bytes = 0;
            const chunks = [];
            stream.on("error", fail);
            stream.on("data", (chunk) => {
              bytes += chunk.length;
              if (bytes > 1024 * 1024) {
                stream.destroy();
                return fail(new Error("DOCX expansion limit exceeded."));
              }
              chunks.push(chunk);
            });
            stream.on("end", () => {
              try {
                const parser = new SaxesParser({ xmlns: true });
                let inText = false,
                  text = "",
                  truncated = false;
                const append = (value) => {
                  const remaining = MAX_TEXT - text.length;
                  if (value.length > remaining) truncated = true;
                  text += value.slice(0, Math.max(0, remaining));
                };
                parser.on("doctype", () => {
                  throw new Error("DOCTYPE is not supported.");
                });
                parser.on("opentag", (tag) => {
                  if (tag.local === "t") inText = true;
                  if (tag.local === "tab") append("\t");
                  if (tag.local === "br") append("\n");
                });
                parser.on("text", (value) => {
                  if (inText) append(value);
                });
                parser.on("closetag", (tag) => {
                  if (tag.local === "t") inText = false;
                  if (tag.local === "p") append("\n");
                });
                parser.write(Buffer.concat(chunks).toString("utf8")).close();
                zip.on("end", () => resolve({ text: text.trim(), truncated }));
                zip.readEntry(); // Scan remaining directory entries for bounds/duplicates.
              } catch (error) {
                fail(error);
              }
            });
          });
        });
        zip.on("end", () => {
          if (!found) reject(new Error("Missing DOCX document part."));
        });
        zip.readEntry();
      },
    );
  });
}
async function readPdf(buffer) {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const root = path.dirname(
    createRequire(import.meta.url).resolve("pdfjs-dist/package.json"),
  );
  const task = getDocument({
    standardFontDataUrl: `${root}/standard_fonts/`,
    cMapUrl: `${root}/cmaps/`,
    cMapPacked: true,
    data: new Uint8Array(buffer),
    isEvalSupported: false,
    useSystemFonts: false,
    disableFontFace: true,
    isOffscreenCanvasSupported: false,
    useWorkerFetch: false,
    maxImageSize: 0,
    stopAtErrors: true,
  });
  try {
    const pdf = await task.promise;
    let text = "";
    let truncated = pdf.numPages > 50;
    for (let n = 1; n <= Math.min(50, pdf.numPages); n++) {
      const page = await pdf.getPage(n);
      const content = await page.getTextContent();
      const value = content.items
        .map((item) =>
          "str" in item ? item.str + (item.hasEOL ? "\n" : " ") : "",
        )
        .join("");
      const remaining = MAX_TEXT - text.length;
      const fullPage = `\n--- Page ${n} ---\n` + value;
      text += fullPage.slice(0, remaining);
      if (fullPage.length > remaining || text.length >= MAX_TEXT) {
        truncated = true;
        break;
      }
      page.cleanup();
    }
    // Page markers alone are not text extraction (scanned PDFs need OCR).
    if (!text.replace(/--- Page \d+ ---/g, "").trim())
      throw new Error("No selectable text. OCR is not supported.");
    return { text: text.trim(), truncated, pages: pdf.numPages };
  } finally {
    await task.destroy();
  }
}
try {
  const buffer = Buffer.from(workerData.bytes);
  const result =
    workerData.format === "pdf"
      ? await readPdf(buffer)
      : await readDocx(buffer);
  if (!result.text) throw new Error("No readable text found.");
  parentPort.postMessage({ ok: true, ...result });
} catch {
  // Do not reflect arbitrary parser/file contents into errors or server logs.
  parentPort.postMessage({ ok: false });
}
