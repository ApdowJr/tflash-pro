import { connect } from "@vercel/connect/eve";
import { defineMcpClientConnection } from "eve/connections";
import { always } from "eve/tools/approval";

export default defineMcpClientConnection({
  url: "https://mcp.resend.com",
  description: "Send transactional emails from your apps.",
  auth: connect("mcp.resend.com/" + process.env.VERCEL_PROJECT_ID),
  // Sending email or changing a domain needs a separate human decision.
  approval: always(),
});
