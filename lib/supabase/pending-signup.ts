// Only the email and resend deadline are kept per tab; never store a password
// or confirmation code. The flow remains usable if sessionStorage is blocked.
export const PENDING_SIGNUP_KEY = "tflash:pending-signup";
export const RESEND_DELAY_MS = 60_000;

export type PendingSignup = { email: string; resendAt: number };

export function rememberSignup(pending: PendingSignup): void {
  try {
    sessionStorage.setItem(PENDING_SIGNUP_KEY, JSON.stringify({ email: pending.email, resendAt: pending.resendAt }));
  } catch { /* private browsing */ }
}

export function forgetSignup(): void {
  try { sessionStorage.removeItem(PENDING_SIGNUP_KEY); } catch { /* private browsing */ }
}

export function readPendingSignup(): PendingSignup | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(PENDING_SIGNUP_KEY) ?? "null") as Partial<PendingSignup> | null;
    if (!value || typeof value.email !== "string" || value.email.length > 254 ||
        !/^[^\s@]+@[^\s@]+$/.test(value.email) || typeof value.resendAt !== "number" ||
        !Number.isFinite(value.resendAt)) return null;
    return { email: value.email, resendAt: Math.min(value.resendAt, Date.now() + RESEND_DELAY_MS) };
  } catch { return null; }
}
