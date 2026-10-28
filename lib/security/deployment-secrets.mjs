import { createHmac } from "node:crypto";

/**
 * Select private signing/encryption material without exposing a secret.
 *
 * A Git preview can explicitly opt into deriving isolated keys from the
 * existing Better Auth secret. The environment and branch checks ensure this
 * never enables a production fallback, and the purpose + branch are separated
 * so preview credentials and ownership proofs cannot be replayed elsewhere.
 * A real production deployment should set both dedicated random secrets.
 */
/** @param {"session" | "credentials"} purpose */
export function deploymentSecret(purpose) {
  const explicit = purpose === "session"
    ? process.env.TFLASH_SESSION_SECRET || process.env.PROVIDER_KEYS_SECRET
    : process.env.PROVIDER_KEYS_SECRET || process.env.TFLASH_SESSION_SECRET;
  if (explicit) return explicit;

  const root = process.env.BETTER_AUTH_SECRET;
  const branch = process.env.VERCEL_GIT_COMMIT_REF;
  if (
    process.env.NODE_ENV === "production" &&
    process.env.VERCEL_ENV === "preview" &&
    process.env.TFLASH_PREVIEW_USE_AUTH_SECRET === "1" &&
    root && root.length >= 32 &&
    branch && branch.length <= 256
  ) {
    return createHmac("sha256", root)
      .update(JSON.stringify(["tflash-preview-secret-v1", purpose, branch]))
      .digest("hex");
  }
  return undefined;
}
