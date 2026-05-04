import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { contentToText } from "../helpers";

export type ArchonToolResult = {
  content: Array<{ type: string; text: string }>;
  details?: Record<string, unknown>;
};

export abstract class ArchonHandler {
  abstract run(pi: ExtensionAPI, ctx: ExtensionCommandContext, args: string[]): Promise<void>;

  async runTool(pi: ExtensionAPI, ctx: ExtensionCommandContext, args: string[]): Promise<ArchonToolResult> {
    const messages: ArchonToolResult["content"] = [];
    let details: Record<string, unknown> | undefined;
    const toolPi = {
      ...pi,
      sendMessage(payload: { content?: unknown; details?: Record<string, unknown> }) {
        messages.push({ type: "text", text: contentToText(payload.content) });
        if (payload.details) details = { ...(details ?? {}), ...payload.details };
      },
    } as ExtensionAPI;
    await this.run(toolPi, ctx, args);
    return { content: messages.length ? messages : [{ type: "text", text: "" }], details };
  }
}
