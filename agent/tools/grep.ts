import { sessionAgentMode } from "../lib/session-mode";
import { defineDynamic } from "eve/tools";
import { grep } from "eve/tools/grep";

export default defineDynamic(async (ctx) => await sessionAgentMode(ctx) === "coder" ? grep : null);
