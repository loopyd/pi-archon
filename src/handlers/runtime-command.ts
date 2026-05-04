import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { ArchonHandler } from "./base";

export type RuntimeMode = "start" | "stop" | "status";

export abstract class RuntimeModeHandler extends ArchonHandler {
  protected abstract mode: RuntimeMode;
  protected abstract runRuntime(pi: ExtensionAPI, ctx: ExtensionCommandContext, args: string[]): Promise<void>;

  async run(pi: ExtensionAPI, ctx: ExtensionCommandContext, args: string[]): Promise<void> {
    await this.runRuntime(pi, ctx, [this.mode, ...args]);
  }
}
