import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { ArchonHandler } from "./base";
import { handleArchonStatusCommand, handleArchonWorkflowCancelCommand } from "./manage-runtime";

export class ManageStatusHandler extends ArchonHandler {
  async run(pi: ExtensionAPI, ctx: ExtensionCommandContext, _args: string[]): Promise<void> {
    await handleArchonStatusCommand(pi, ctx);
  }
}

export class ManageCancelHandler extends ArchonHandler {
  async run(pi: ExtensionAPI, ctx: ExtensionCommandContext, args: string[]): Promise<void> {
    await handleArchonWorkflowCancelCommand(pi, args.join(" ").trim(), ctx);
  }
}
