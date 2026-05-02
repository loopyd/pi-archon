import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { Markdown, Text, Container, Spacer } from "@mariozechner/pi-tui";

import { registerCliRoutes, registerArchonTools } from "./archon-routes";
import { normalizeWorkflow } from "./archon-ui";
import { runArchonCommandWithToolUpdates, formatArchonOutput, formatArchonToolResult } from "./archon-exec";
import { rollupStaleRefs, auditAllSubmoduleRefs, fetchSubmodules, readSubmodulePaths, isOwnedRepo, parseLines } from "./git-util";
import { buildCompletions } from "./command-tree";

const passthrough = (text: string) => text;

function getArchonMarkdownTheme(theme: any) {
  return {
    heading: (text: string) => theme.bold(theme.fg("accent", text)),
    link: (text: string) => theme.fg("accent", text),
    linkUrl: (text: string) => theme.fg("dim", text),
    code: (text: string) => theme.fg("warning", text),
    codeBlock: passthrough,
    codeBlockBorder: (text: string) => theme.fg("border", text),
    quote: (text: string) => theme.fg("muted", text),
    quoteBorder: (text: string) => theme.fg("border", text),
    hr: (text: string) => theme.fg("border", text),
    listBullet: (text: string) => theme.fg("accent", text),
    bold: (text: string) => theme.bold(text),
    italic: passthrough,
    strikethrough: passthrough,
    underline: passthrough,
    codeBlockIndent: "  ",
  };
}

// ─── Factory entry point (default export required by pi loader) ──────────────

// ─── Custom message renderer for all archon output ──────────────

/** Render archon custom messages with proper markdown styling */
const archonMessageRenderer = (message: any, options: { expanded: boolean }, theme: any) => {
  const container = new Container();
  container.addChild(new Spacer(1));

  // Label line
  const label = `[${theme.fg("accent", "archon")}]`;
  container.addChild(new Text(label, 1, 0));

  // Content rendered as markdown
  if (typeof message.content === "string") {
    const md = new Markdown(message.content, 1, 0, getArchonMarkdownTheme(theme), {
      color: (text: string) => text,
    });
    container.addChild(md);
  }

  // Expanded details
  if (options.expanded && message.details) {
    container.addChild(new Spacer(1));
    container.addChild(new Text(theme.fg("dim", JSON.stringify(message.details, null, 2)), 1, 0));
  }

  container.addChild(new Spacer(1));
  return container;
};

// ─── Factory entry point (default export required by pi loader) ──────────────

export default async function onEnable(api: ExtensionAPI): Promise<void> {
  try {
    // Register a custom renderer so archon messages display properly in chat
    api.registerMessageRenderer("archon", archonMessageRenderer);

    // Register the main /archon command so it appears in pi's command palette
    api.registerCommand("archon", {
      description: "Archon workspace launcher — plan/implement/validate workflows, cleanup, web dev",
      getArgumentCompletions: (prefix: string) => {
        const completions = buildCompletions();
        return prefix.length > 0
          ? completions.filter((c) => c.value.toLowerCase().startsWith(prefix.toLowerCase()))
          : null; // show all only when explicitly requested
      },
      handler: async (args: string, ctx: ExtensionCommandContext) => {
        await registerCliRoutes(api, { ...ctx, args } as any);
      },
    });
    registerArchonTools(api);
  } catch { /* best-effort */ }
}

// ─── Re-exports for consumers outside this extension ──────────────

export { normalizeWorkflow };
export { runArchonCommandWithToolUpdates, formatArchonOutput, formatArchonToolResult };
export { createMessageEmitter } from "./helpers";
export { rollupStaleRefs, auditAllSubmoduleRefs, fetchSubmodules, readSubmodulePaths, isOwnedRepo, parseLines } from "./git-util";
// Command registry
export { ArchonCommand, ArchonRegistry, isGroup } from "./command-base";
export { archonTree, getAllLeaves, getHandler, resolveTokens, generateFullHelp, generateScopedHelp, generateGroupHelp, isHelpTrigger, buildCompletions } from "./command-tree";
export type { CompletionItem } from "./command-tree";
export type { CommandNode, SubCommandMeta, CommandGroupMeta, PositionalArg, FlagDef } from "./command-base";

