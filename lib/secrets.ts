/**
 * Shared AES-GCM sealing used for every browser-supplied credential.
 *
 * Both provider keys and integration tokens travel as `v1.<iv>.<ciphertext>`
 * opaque strings, so the browser never holds plaintext secrets and the server
 * can validate a token cryptographically before trusting it.
 *
 * Server-only: the key material comes from `process.env`.
 */

import { deploymentSecret } from "./security/deployment-secrets.mjs";

const TOKEN_PREFIX = "v1";
const encoder = new TextEncoder();

export type SealedEnvelope = {
  readonly v: 1;
  readonly expiresAt: number;
  readonly [key: string]: unknown;
};

function secretMaterial(): string {
  const secret = deploymentSecret("credentials");
  if (process.env.NODE_ENV === "production" && (!secret || secret.length < 32)) {
    throw new Error("Set PROVIDER_KEYS_SECRET to a random value of at least 32 characters.");
  }
  // Legacy namespace kept on purpose: tokens sealed before the T Flash rename
  // must keep decrypting until they expire.
  return `ururka:provider-credentials:v1:${secret || "ururka-local-development-only"}`;
}

async function encryptionKey(): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(secretMaterial()));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Returns a plain ArrayBuffer so it satisfies Web Crypto's BufferSource. */
function fromBase64Url(value: string): ArrayBuffer {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

/** True when a string looks like a sealed token from this module. */
export function isSealedToken(value: unknown): value is string {
  return typeof value === "string" && value.startsWith(`${TOKEN_PREFIX}.`) && value.length <= 8192;
}

export async function sealJson(
  payload: Record<string, unknown>,
  ttlMs: number,
): Promise<{ token: string; expiresAt: number }> {
  const expiresAt = Date.now() + ttlMs;
  const body = JSON.stringify({ v: 1, ...payload, issuedAt: Date.now(), expiresAt });
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await encryptionKey(),
    encoder.encode(body),
  );
  return {
    token: `${TOKEN_PREFIX}.${toBase64Url(iv)}.${toBase64Url(new Uint8Array(ciphertext))}`,
    expiresAt,
  };
}

/** Returns null for expired, tampered, or malformed tokens. */
export async function openJson<T extends SealedEnvelope>(
  token: string | undefined,
  validate?: (payload: T) => boolean,
): Promise<T | null> {
  if (!isSealedToken(token)) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64Url(parts[1]!) },
      await encryptionKey(),
      fromBase64Url(parts[2]!),
    );
    const payload = JSON.parse(new TextDecoder().decode(plaintext)) as T;
    if (payload.v !== 1 || typeof payload.expiresAt !== "number") return null;
    if (payload.expiresAt <= Date.now()) return null;
    if (validate && !validate(payload)) return null;
    return payload;
  } catch {
    return null;
  }
}
