import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import type { ArchonTheme } from "./types";

interface ArchonCustomMessage {
  content?: unknown;
  details?: unknown;
}

interface MessageRendererCapableExtensionAPI extends ExtensionAPI {
  registerMessageRenderer(customType: string, renderer: typeof archonMessageRenderer): void;
}

interface CommandCapableExtensionAPI extends ExtensionAPI {
  registerCommand(name: string, config: {
    description: string;
    getArgumentCompletions: (prefix: string) => { value: string; description?: string }[] | null;
    handler: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
  }): void;
}

import { registerCliRoutes, registerArchonTools } from "./archon-routes";
import { normalizeWorkflow } from "./archon-ui";
import { runArchonCommandWithToolUpdates, formatArchonOutput, formatArchonToolResult } from "./archon-exec";
import { rollupStaleRefs, auditAllSubmoduleRefs, fetchSubmodules, readSubmodulePaths, isOwnedRepo, parseLines } from "./git-util";
import { buildCompletions } from "./command-tree";
import { refreshProjectWorkflowNames } from "./workflow-discovery";
import { ArchonMessagePanel } from "./ui/message-panel";

const archonMessageRenderer = (message: ArchonCustomMessage, options: { expanded: boolean }, _theme: ArchonTheme) => {
  return new ArchonMessagePanel(message.content, message.details, options.expanded);
};

export default async function onEnable(api: ExtensionAPI): Promise<void> {
  try {
    const messageApi = api as MessageRendererCapableExtensionAPI;
    const commandApi = api as CommandCapableExtensionAPI;

    messageApi.registerMessageRenderer("archon", archonMessageRenderer);

    commandApi.registerCommand("archon", {
      description: "Archon workspace launcher — project workflows, cleanup, web dev",
      getArgumentCompletions: (prefix: string) => {
        const completions = buildCompletions();
        return prefix.length > 0
          ? completions.filter((c) => c.value.toLowerCase().startsWith(prefix.toLowerCase()))
          : null;
      },
      handler: async (args: string, ctx: ExtensionCommandContext) => {
        try {
          await refreshProjectWorkflowNames(ctx.cwd || process.cwd());
        } catch {}
        await registerCliRoutes(api, { ...ctx, args });
      },
    });
    void refreshProjectWorkflowNames(process.cwd()).catch(() => undefined);
    registerArchonTools(api);
  } catch { /* best-effort */ }
}

export { normalizeWorkflow };
export { runArchonCommandWithToolUpdates, formatArchonOutput, formatArchonToolResult };
export { createMessageEmitter } from "./helpers";
export { rollupStaleRefs, auditAllSubmoduleRefs, fetchSubmodules, readSubmodulePaths, isOwnedRepo, parseLines } from "./git-util";
export { ArchonCommand } from "./commands/base";
export { isGroup } from "./commands/defs";
export { archonTree, getAllLeaves, getHandler, resolveTokens, generateFullHelp, generateScopedHelp, generateGroupHelp, isHelpTrigger, buildCompletions } from "./command-tree";
export type { CompletionItem } from "./command-tree";
export type { CommandNode, SubCommandMeta, CommandGroupMeta, PositionalArg, FlagDef } from "./commands/defs";
