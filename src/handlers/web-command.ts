import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { RuntimeModeHandler } from "./runtime-command";
import { handleArchonWebCommand } from "./web-runtime";

abstract class WebModeHandler extends RuntimeModeHandler {
  protected async runRuntime(pi: ExtensionAPI, ctx: ExtensionCommandContext, args: string[]): Promise<void> {
    await handleArchonWebCommand(pi, args, ctx);
  }
}

export class WebStartHandler extends WebModeHandler { protected mode: "start" = "start"; }
export class WebStopHandler extends WebModeHandler { protected mode: "stop" = "stop"; }
export class WebStatusHandler extends WebModeHandler { protected mode: "status" = "status"; }
