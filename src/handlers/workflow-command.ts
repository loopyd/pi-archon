import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { DEFAULT_QUERY } from "../constants";
import { handleWorkflowCommand } from "../archon-workflow-cmd";
import { ArchonHandler } from "./base";

export class WorkflowRunHandler extends ArchonHandler {
  async run(pi: ExtensionAPI, ctx: ExtensionCommandContext, args: string[]): Promise<void> {
    await handleWorkflowCommand(pi, args[0], args.slice(1).join(" ").trim() || DEFAULT_QUERY, ctx);
  }
}
