/** Shared limits and the small text-only response returned by chat search. */
export const MIN_MESSAGE_QUERY_LENGTH = 2;
export const MAX_MESSAGE_QUERY_LENGTH = 160;

export type SearchSnippet = {
  readonly before: string;
  readonly match: string;
  readonly after: string;
};

export type ChatSearchResult =
  | { readonly status: "matched"; readonly snippet: SearchSnippet }
  | { readonly status: "no-match" }
  | { readonly status: "unavailable" };
