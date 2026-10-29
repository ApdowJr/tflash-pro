/** Server-only receipts bind retrieved source metadata to an account and chat. */
import { openJson, sealJson, type SealedEnvelope } from "./secrets";
import { fetchedSourceSchema, type FetchedSource } from "./research";

type ResearchContext = {
  readonly session: {
    readonly id: string;
    readonly auth: {
      readonly current?: { readonly principalId?: string; readonly principalType?: string } | null;
      readonly initiator?: { readonly principalId?: string; readonly principalType?: string } | null;
    };
  };
};
export function researchOwner(ctx: ResearchContext): { ownerId: string; sessionId: string } {
  const auth = ctx.session.auth.current ?? ctx.session.auth.initiator;
  if (auth?.principalType !== "user" || !auth.principalId || !ctx.session.id) {
    throw new Error("Research requires an authenticated conversation.");
  }
  return { ownerId: auth.principalId, sessionId: ctx.session.id };
}

type SourceReceipt = SealedEnvelope & {
  readonly kind: "tflash-source-receipt";
  readonly ownerId: string;
  readonly sessionId: string;
  readonly source: FetchedSource;
};
export async function sealSourceReceipt(source: FetchedSource, ctx: ResearchContext): Promise<string> {
  const owner = researchOwner(ctx);
  return (await sealJson({ kind: "tflash-source-receipt", ...owner, source: fetchedSourceSchema.parse(source) }, 7 * 86400000)).token;
}
export async function readSourceReceipt(receipt: string, ctx: ResearchContext): Promise<FetchedSource> {
  const { ownerId, sessionId } = researchOwner(ctx);
  const result = await openJson<SourceReceipt>(receipt, (data) => data.kind === "tflash-source-receipt" && data.ownerId === ownerId && data.sessionId === sessionId && fetchedSourceSchema.safeParse(data.source).success);
  if (!result) throw new Error("Source receipt is expired, invalid, or belongs to another conversation. Fetch the source again.");
  return fetchedSourceSchema.parse(result.source);
}
