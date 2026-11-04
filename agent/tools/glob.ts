import { sessionAgentMode } from "../lib/session-mode";
import { defineDynamic } from "eve/tools";
import { glob } from "eve/tools/glob";

export default defineDynamic(async (ctx) => await sessionAgentMode(ctx) === "coder" ? glob : null);
