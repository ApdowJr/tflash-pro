import { currentPrincipal } from "@/lib/identity";
import {
  boundedBody,
  documentExportSchema,
  exportDocument,
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
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    return Response.json({ error: "Expected JSON." }, { status: 415 });
  try {
    const input = documentExportSchema.parse(
      JSON.parse(new TextDecoder().decode(await boundedBody(request, 350_000))),
    );
    const bytes = await exportDocument(input);
    const filename = input.filename.replace(/\.(md|txt)$/, `.${input.format}`);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "content-type":
          input.format === "pdf"
            ? "application/pdf"
            : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "content-disposition": `attachment; filename="${filename}"`,
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return Response.json(
      {
        error:
          "Document export failed. Maximum 50,000 text characters and 100 PDF pages. Try DOCX for unsupported PDF glyphs.",
      },
      { status: 422, headers: { "cache-control": "no-store" } },
    );
  }
}
