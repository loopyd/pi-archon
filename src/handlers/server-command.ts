import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { RuntimeModeHandler } from "./runtime-command";
import { handleArchonServerCommand } from "./server-runtime";

abstract class ServerModeHandler extends RuntimeModeHandler {
  protected async runRuntime(pi: ExtensionAPI, ctx: ExtensionCommandContext, args: string[]): Promise<void> {
    await handleArchonServerCommand(pi, args, ctx);
  }
}

export class ServerStartHandler extends ServerModeHandler { protected mode: "start" = "start"; }
export class ServerStopHandler extends ServerModeHandler { protected mode: "stop" = "stop"; }
export class ServerStatusHandler extends ServerModeHandler { protected mode: "status" = "status"; }
