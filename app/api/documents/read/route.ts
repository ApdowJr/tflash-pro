import { expectedPrincipalMatches } from "@/lib/security/expected-principal";
import { currentPrincipal } from "@/lib/identity";
import {
  boundedBody,
  extractDocument,
  MAX_DOCUMENT_BYTES,
} from "@/lib/documents/server";
import { guardRateLimit } from "@/lib/security/rate-limits";
import { apiRoute } from "@/lib/http/api-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
async function handlePost(request: Request): Promise<Response> {
  const principal = await currentPrincipal();
  if (!principal)
    return Response.json({ error: "Sign in to continue." }, { status: 401 });
  if (!expectedPrincipalMatches(request, principal))
    return Response.json({ error: "Account changed. Reload to continue." }, { status: 409, headers: { "cache-control": "no-store" } });
  const limited = guardRateLimit("documents", request, principal.id);
  if (limited) return limited;
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

export const POST = apiRoute("documents:read", handlePost);
