/**
 * Client-safe wire constants for integration tokens.
 *
 * Kept separate from `credentials.ts` (which touches server-only crypto) so the
 * browser can import the header name without pulling sealing code into the
 * client bundle.
 */

/** Request header carrying the sealed tokens, one per connection. */
export const HEADER_INTEGRATION_TOKENS = "x-tflash-integrations";
/** Session attribute the channel writes them to (still sealed). */
export const ATTR_INTEGRATION_TOKENS = "tflash:integrations";
