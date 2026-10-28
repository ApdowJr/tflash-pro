/** Keep simultaneous sign-up and recovery links tied to their own verifier. */
export const browserAuthOptions = {
  experimental: { appendPkceFlowIdToRedirects: true },
} as const;

/** Older links without a flow id remain compatible with the default verifier. */
export function callbackFlowOptions(url: URL): { flowId: string } | undefined {
  const flowId = url.searchParams.get("sb_flow_id");
  return flowId === null ? undefined : { flowId };
}
