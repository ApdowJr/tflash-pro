/** Bind a browser request to the verified principal that initiated it.
 * Missing headers remain compatible with older clients; this is not auth. */
export function expectedPrincipalMatches(request: Request | undefined, principal: { id: string; kind: string }): boolean {
  if (!request) return true;
  const id = request.headers.get("x-tflash-expected-user-id");
  const kind = request.headers.get("x-tflash-expected-account-kind");
  return (id === null || id === principal.id) && (kind === null || kind === principal.kind);
}
