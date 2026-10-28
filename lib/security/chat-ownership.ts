import { createHmac, timingSafeEqual } from "node:crypto";
import { deploymentSecret } from "./deployment-secrets.mjs";

export const CREATE_PROOF_HEADER = "x-tflash-create-proof";
/** Vercel-account chats keep their signed ownership proof in account-scoped browser storage. */
export const OWNER_PROOF_HEADER = "x-tflash-owner-proof";

/** Keep stable across all Next/eve instances. Never expose this secret. */
function secret(): string {
  const value = deploymentSecret("session");
  if (value && value.length >= 32) return value;
  if (process.env.NODE_ENV !== "production") return "tflash-local-development-only-change-before-deploy";
  throw new Error("Set TFLASH_SESSION_SECRET to a random value of at least 32 characters.");
}

function signature(parts: readonly string[]): string {
  return createHmac("sha256", secret()).update(JSON.stringify(parts)).digest("base64url");
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** A signed row ties the server-created eve session to one Supabase user.
 * RLS alone cannot prove the session ID belongs to the person inserting it. */
export function signChatOwnership(userId: string, sessionId: string): string {
  return signature(["tflash-chat-v1", userId, sessionId]);
}

export function verifyChatOwnership(userId: string, sessionId: string, proof: unknown): boolean {
  return typeof proof === "string" && safeEqual(proof, signChatOwnership(userId, sessionId));
}

/** Only the Next server can authorize an otherwise unbound eve create call. */
export function signChatCreation(userId: string, now = Date.now()): string {
  const time = String(Math.floor(now / 1000));
  return `${time}.${signature(["tflash-create-v1", userId, time])}`;
}

export function verifyChatCreation(userId: string, proof: string | null, now = Date.now()): boolean {
  if (!proof) return false;
  const [time, value, ...extra] = proof.split(".");
  if (!time || !value || extra.length || !/^\d{1,12}$/.test(time)) return false;
  if (Math.abs(Math.floor(now / 1000) - Number(time)) > 60) return false;
  return safeEqual(value, signature(["tflash-create-v1", userId, time]));
}
