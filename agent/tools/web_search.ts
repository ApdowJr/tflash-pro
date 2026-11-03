// Keep Eve's native search for supported direct providers and its existing Exa
// default through AI Gateway. Do not reroute unsupported providers or keys.
import { webSearch } from "eve/tools/web_search";

export default webSearch({ provider: "exa" });
