import { webSearch } from "eve/tools/web_search";

// Keep native search for supported direct providers and Exa for AI Gateway.
export default webSearch({ provider: "exa" });
