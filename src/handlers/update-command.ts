import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { ArchonHandler } from "./base";
import { handleArchonUpdateCommand } from "./update-runtime";

export class UpdateHandler extends ArchonHandler {
  async run(pi: ExtensionAPI, ctx: ExtensionCommandContext, args: string[]): Promise<void> {
    await handleArchonUpdateCommand(pi, args, ctx);
  }
}
