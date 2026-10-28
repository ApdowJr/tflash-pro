import { connect } from "@vercel/connect/eve";
import { defineMcpClientConnection } from "eve/connections";
import { always } from "eve/tools/approval";

export default defineMcpClientConnection({
  url: "https://mcp.supabase.com/mcp",
  description: "Manage databases, authentication, and storage.",
  auth: connect("mcp.supabase.com/" + process.env.VERCEL_PROJECT_ID),
  // Database and auth tools may have sensitive or destructive effects.
  approval: always(),
});
