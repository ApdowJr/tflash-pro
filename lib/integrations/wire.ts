/**
 * Client-safe wire constants for integration credentials.
 *
 * Kept separate from `credentials.ts` and `oauth.ts` (which touch server-only
 * crypto and `process.env`) so the browser can import header names, cookie
 * names and the shape of a sealed record without pulling server code into the
 * client bundle.
 */

/** Request header carrying the sealed tokens, one per connection. */
export const HEADER_INTEGRATION_TOKENS = "x-tflash-integrations";
/** Session attribute the channel writes them to (still sealed). */
export const ATTR_INTEGRATION_TOKENS = "tflash:integrations";

/** Short-lived cookie that hands a freshly granted OAuth token back to the app. */
export const OAUTH_HANDOFF_COOKIE = "tflash-oauth-handoff";
/** Sealed `state` parameter: how long a started authorization stays valid. */
export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
/** The handoff cookie only needs to survive one redirect. */
export const OAUTH_HANDOFF_TTL_MS = 5 * 60 * 1000;

/** Dynamically registered OAuth credentials, only stored inside sealed envelopes. */
export type OAuthClientRegistration = {
  readonly clientId: string;
  readonly clientSecret?: string;
};

/** What a sealed `state` parameter carries between authorize and callback. */
export type OAuthEnvelope = {
  readonly v: 1;
  readonly expiresAt: number;
  readonly integrationId: string;
  readonly ownerId: string;
  readonly ownerKind?: "supabase" | "vercel";
  readonly flowId: string;
  readonly nonce: string;
  readonly verifier?: string;
  readonly client?: OAuthClientRegistration;
  readonly returnTo?: string;
};
