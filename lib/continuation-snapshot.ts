/** Untrusted continuation wire data. A null attempt is valid only in a complete snapshot. */
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const object = (value: unknown): Record<string, unknown> | undefined => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const validId = (value: unknown): value is string => typeof value === "string" && uuid.test(value);
const validDate = (value: unknown): value is string => typeof value === "string" && value.length <= 40 && Number.isFinite(Date.parse(value));
const validNote = (value: unknown): value is string => typeof value === "string" && value.trim().length >= 10 && value.length <= 1000;
export type ContinuationAttempt = { attemptId: string; state: "reserved" | "dispatching"; createdAt: string; reviewRevision: string; holdNote: string | null; holdAt: string | null };
export type ContinuationHistoryEntry = { attemptId: string; reviewedAt: string; note: string };
export type ContinuationSnapshot = { attempt: ContinuationAttempt | null; history: ContinuationHistoryEntry[] };

export function parseContinuationAttempt(value: unknown): ContinuationAttempt | undefined {
  const a = object(value);
  if (!a || !validId(a.attemptId) || !validId(a.reviewRevision) || !validDate(a.createdAt) ||
      (a.state !== "reserved" && a.state !== "dispatching") ||
      !((a.holdNote === null && a.holdAt === null) || (validNote(a.holdNote) && validDate(a.holdAt)))) return undefined;
  return { attemptId: a.attemptId, state: a.state, createdAt: a.createdAt, reviewRevision: a.reviewRevision, holdNote: a.holdNote as string | null, holdAt: a.holdAt as string | null };
}
export function parseContinuationHistory(value: unknown): ContinuationHistoryEntry[] | undefined {
  if (!Array.isArray(value) || value.length > 20) return undefined;
  const entries: ContinuationHistoryEntry[] = [], seen = new Set<string>();
  for (const item of value) {
    const h = object(item);
    if (!h || !validId(h.attemptId) || seen.has(h.attemptId.toLowerCase()) || !validDate(h.reviewedAt) || !validNote(h.note)) return undefined;
    seen.add(h.attemptId.toLowerCase()); entries.push({ attemptId: h.attemptId, reviewedAt: h.reviewedAt, note: h.note });
  }
  return entries;
}
export function parseContinuationSnapshot(value: unknown): ContinuationSnapshot | undefined {
  const snapshot = object(value);
  if (!snapshot || !("attempt" in snapshot) || !("history" in snapshot)) return undefined;
  const attempt = snapshot.attempt === null ? null : parseContinuationAttempt(snapshot.attempt);
  const history = parseContinuationHistory(snapshot.history);
  if (attempt === undefined || !history || (attempt && history.some(item => item.attemptId.toLowerCase() === attempt.attemptId.toLowerCase()))) return undefined;
  return { attempt, history };
}
