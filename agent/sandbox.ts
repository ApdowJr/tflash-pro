import { DefaultSandbox, defineSandbox } from "eve/sandbox";

export const environment = DefaultSandbox.environment();

// Provider requests and Eve's web tools run outside this shell sandbox. In
// production, a shell command should not be able to exfiltrate attached files
// or contact arbitrary hosts. just-bash cannot restrict egress in local dev.
export default defineSandbox(() => environment.open({
  networkPolicy: process.env.EVE_DEV === "1" ? "allow-all" : "deny-all",
}));
