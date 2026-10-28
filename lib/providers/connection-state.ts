/** Display state only. The server always validates the sealed token itself. */
const LEGACY_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function providerConnectionExpired(
  connection: { readonly token?: string; readonly connectedAt: number; readonly expiresAt?: number } | undefined,
  now = Date.now(),
): boolean {
  if (!connection?.token) return false;
  const expiresAt = connection.expiresAt ?? connection.connectedAt + LEGACY_TOKEN_TTL_MS;
  return Number.isFinite(expiresAt) && expiresAt <= now;
}
