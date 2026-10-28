import { connect } from "@vercel/connect/eve";
import { defineMcpClientConnection } from "eve/connections";
import { always } from "eve/tools/approval";

export default defineMcpClientConnection({
  url: "https://mcp.vercel.com",
  description: "Deploy agents and apps, manage projects, and more.",
  auth: connect("mcp.vercel.com/" + process.env.VERCEL_PROJECT_ID),
  // Deployments and project tools require the user's explicit approval.
  approval: always(),
});
