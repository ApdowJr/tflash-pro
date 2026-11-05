/** Keeps the event loop referenced while a wait is pending; cleared on settle. */
const KEEP_ALIVE_MS = 2 ** 30;

/** Stop waiting on cancellation, even if a dependency ignores its signal.
 * This does not undo side effects already started by that dependency.
 *
 * A pending await must also keep the event loop alive. Deadline signals built
 * with `AbortSignal.timeout()` use unref'ed timers, so a process with no other
 * work would otherwise exit before the deadline fires and this wait would never
 * settle (the abort listener and the pending promise hold no handles).
 */
export function waitWithAbort<T>(operation: PromiseLike<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      // The operation may already have started; consume any later rejection.
      void Promise.resolve(operation).catch(() => {});
      reject(signal.reason);
      return;
    }
    const onAbort = () => { cleanup(); reject(signal.reason); };
    const keeper = setInterval(() => {}, KEEP_ALIVE_MS);
    const cleanup = () => {
      clearInterval(keeper);
      signal.removeEventListener("abort", onAbort);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve(operation).then(
      (value) => { cleanup(); resolve(value); },
      (error) => { cleanup(); reject(error); },
    );
  });
}
