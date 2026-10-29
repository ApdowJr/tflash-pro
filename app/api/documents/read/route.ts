import { currentPrincipal } from "@/lib/identity";
import {
  boundedBody,
  extractDocument,
  MAX_DOCUMENT_BYTES,
} from "@/lib/documents/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
export async function POST(request: Request): Promise<Response> {
  if (!(await currentPrincipal()))
    return Response.json({ error: "Sign in to continue." }, { status: 401 });
  if (
    request.headers.get("sec-fetch-site") === "cross-site" ||
    (request.headers.get("origin") &&
      request.headers.get("origin") !== new URL(request.url).origin)
  )
    return Response.json(
      { error: "Same-origin request required." },
      { status: 403 },
    );
  const type = request.headers.get("content-type")?.split(";")[0];
  const format =
    type === "application/pdf"
      ? "pdf"
      : type ===
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        ? "docx"
        : undefined;
  if (!format)
    return Response.json({ error: "Expected PDF or DOCX." }, { status: 415 });
  try {
    const result = await extractDocument(
      await boundedBody(request, MAX_DOCUMENT_BYTES),
      format,
    );
    return Response.json(result, { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json(
      {
        error:
          "Document could not be read. Maximum 2 MiB, 50 PDF pages, 100,000 text characters. No OCR or encrypted files.",
      },
      { status: 422, headers: { "cache-control": "no-store" } },
    );
  }
}
