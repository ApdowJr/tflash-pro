import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { bash } from "eve/tools/bash";

// Shell commands can have network and filesystem side effects, even in a sandbox.
export default defineTool({ ...bash, approval: always() });
