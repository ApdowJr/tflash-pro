import { sessionAgentMode } from "../lib/session-mode";
import { defineDynamic } from "eve/tools";
import { readFile } from "eve/tools/read_file";

export default defineDynamic(async (ctx) => await sessionAgentMode(ctx) === "coder" ? readFile : null);
