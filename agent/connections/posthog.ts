import { defineIntegrationConnection } from "@/lib/integrations/connection";

/**
 * posthog — MCP endpoint, credential resolution, tool filter, and approval gate
 * all live in `lib/integrations/catalog.ts`. eve takes this connection's name
 * from the filename, so the file stays a one-liner.
 */
export default defineIntegrationConnection("posthog");
