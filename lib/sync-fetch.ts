import { waitWithAbort } from "@/lib/abortable";

/** Bound both the response and JSON read, even for transports that ignore
 * abort. A timeout is not proof that a mutation did not reach the server. */
export async function syncFetchJson(url: string, init: RequestInit = {}) {
  const deadline = AbortSignal.timeout(12_000);
  const signal = init.signal ? AbortSignal.any([init.signal, deadline]) : deadline;
  const pending = fetch(url, { ...init, signal });
  void pending.then((response) => {
    if (signal.aborted && response.body) void response.body.cancel().catch(() => {});
  }, () => {});
  const response = await waitWithAbort(pending, signal);
  if (!response.ok) return { response, data: undefined };
  const data: unknown = await waitWithAbort(response.json(), signal);
  return { response, data };
}
