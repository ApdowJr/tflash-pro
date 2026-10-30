import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { BlockList, isIP } from "node:net";
import { homepageOrigin } from "@/lib/permission-scope";
import { waitWithAbort } from "@/lib/abortable";
const blocked = new BlockList();
for (const [ip, bits] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const)
  blocked.addSubnet(ip, bits, "ipv4");
for (const [ip, bits] of [
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
] as const)
  blocked.addSubnet(ip, bits, "ipv6");
const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");
export function publicAddress(ip: string): boolean {
  const f = isIP(ip);
  return f === 4
    ? !blocked.check(ip, "ipv4")
    : f === 6 && globalV6.check(ip, "ipv6") && !blocked.check(ip, "ipv6");
}
/** Public DNS is pinned to the TLS socket. Never follows redirects. */
export async function fetchGrantedHomepage(
  url: string,
  abortSignal?: AbortSignal,
  stillAuthorized?: (signal: AbortSignal) => Promise<boolean>,
) {
  if (!homepageOrigin(url))
    throw new Error("This URL is outside the permission scope.");
  const parsed = new URL(url),
    host = parsed.hostname.replace(/^\[(.*)\]$/, "$1"),
    normalized = host.toLowerCase().replace(/\.$/, "");
  if (normalized === "localhost" || normalized.endsWith(".localhost"))
    throw new Error("The address is not public.");
  const signal = abortSignal
    ? AbortSignal.any([abortSignal, AbortSignal.timeout(20_000)])
    : AbortSignal.timeout(20_000);
  if (signal.aborted) throw signal.reason;
  const literal = isIP(host);
  const addresses = literal
    ? [{ address: host, family: literal }]
    : await new Promise<Awaited<ReturnType<typeof lookup>>[]>(
        (resolve, reject) => {
          const onAbort = () => reject(signal.reason);
          signal.addEventListener("abort", onAbort, { once: true });
          lookup(host, { all: true, verbatim: true })
            .then(resolve, reject)
            .finally(() => signal.removeEventListener("abort", onAbort));
        },
      );
  if (
    !addresses.length ||
    addresses.some(({ address }) => !publicAddress(address))
  )
    throw new Error("The address is not public.");
  if (stillAuthorized && !(await waitWithAbort(stillAuthorized(signal), signal)))
    throw new Error(
      "The reusable permission is no longer active; request approval again.",
    );
  if (signal.aborted) throw signal.reason;
  return await new Promise<{
    content: string;
    contentType: string;
    truncated: boolean;
    url: string;
  }>((resolve, reject) => {
    const chosen = addresses[0];
    const req = request(
      parsed,
      {
        method: "GET",
        signal,
        headers: {
          accept:
            "text/plain, text/html, application/json, application/xml;q=0.8",
        },
        lookup: (_host, options, callback) => {
          if (typeof options === "object" && options.all)
            callback(null, [chosen]);
          else callback(null, chosen.address, chosen.family);
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status < 200 || status >= 300) {
          res.resume();
          reject(
            new Error(
              status >= 300 && status < 400
                ? "Redirects require individual approval."
                : `Request failed with status code: ${status}`,
            ),
          );
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > 1024 * 1024) {
            req.destroy(new Error("Page is too large."));
            return;
          }
          chunks.push(chunk);
        });
        res.on("error", reject);
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          resolve({
            content: text.slice(0, 60_000),
            contentType: String(res.headers["content-type"] ?? ""),
            truncated: text.length > 60_000,
            url,
          });
        });
      },
    );
    req.setTimeout(20_000, () => req.destroy(new Error("Request timed out.")));
    req.on("error", reject);
    req.end();
  });
}
