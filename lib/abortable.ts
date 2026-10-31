/** Stop waiting on cancellation, even if a dependency ignores its signal.
 * This does not undo side effects already started by that dependency.
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
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve(operation).then(
      (value) => { cleanup(); resolve(value); },
      (error) => { cleanup(); reject(error); },
    );
  });
}
