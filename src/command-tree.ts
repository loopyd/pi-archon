import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { ArchonCommand, isGroup } from "./command-base";
import type { CommandNode, SubCommandMeta, CommandGroupMeta } from "./command-base";
import { DEFAULT_QUERY } from "./constants";
import { createMessageEmitter, maybeString, normalizeError, normalizeString } from "./helpers";
import { handleWorkflowCommand } from "./archon-workflow-cmd";
import { handleArchonStatusCommand } from "./archon-routes";
import { handleArchonWebCommand } from "./archon-web-dev";
import { handleArchonServerCommand } from "./archon-server-dev";
import { handleArchonCleanupCommand, handleArchonSyncSubmodulesCommand } from "./archon-cleanup-pipeline";

const emitArchon = createMessageEmitter("archon");

// ════════════════════════════════════════════════════════════════
// Concrete leaf commands — each declares its own metadata
// ════════════════════════════════════════════════════════════════

abstract class PlanCmd extends ArchonCommand {
  static override meta: SubCommandMeta = {
    name: "plan",
    description: "Plan a task.",
    category: "Workflows",
    args: [{ name: "query", required: true, description: "Task description" }],
    examples: ["/archon workflow plan refactor auth module"],
  };
  async execute(_pi: ExtensionAPI, args: string[], ctx: ExtensionCommandContext): Promise<void> {
    const query = maybeString(args.join(" ").trim()) || DEFAULT_QUERY;
    await handleWorkflowCommand({} as ExtensionAPI, "plan", query, ctx);
  }
}

abstract class ImplementCmd extends ArchonCommand {
  static override meta: SubCommandMeta = {
    name: "implement",
    description: "Implement the plan.",
    category: "Workflows",
    args: [{ name: "query", required: false, description: "Optional query override" }],
    examples: ["/archon workflow implement fix memory leak in renderer"],
  };
  async execute(_pi: ExtensionAPI, args: string[], ctx: ExtensionCommandContext): Promise<void> {
    const query = maybeString(args.join(" ").trim()) || DEFAULT_QUERY;
    await handleWorkflowCommand({} as ExtensionAPI, "implement", query, ctx);
  }
}

abstract class ValidateCmd extends ArchonCommand {
  static override meta: SubCommandMeta = {
    name: "validate",
    description: "Validate implementation.",
    category: "Workflows",
    args: [{ name: "query", required: false, description: "Optional query override" }],
    examples: ["/archon workflow validate check diff against binary"],
  };
  async execute(_pi: ExtensionAPI, args: string[], ctx: ExtensionCommandContext): Promise<void> {
    const query = maybeString(args.join(" ").trim()) || DEFAULT_QUERY;
    await handleWorkflowCommand({} as ExtensionAPI, "validate", query, ctx);
  }
}

abstract class StatusCmd extends ArchonCommand {
  static override meta: SubCommandMeta = {
    name: "status",
    description: "Show Archon project status.",
    category: "Management",
    examples: ["/archon manage status"],
  };
  async execute(pi: ExtensionAPI, _args: string[], ctx: ExtensionCommandContext): Promise<void> {
    await handleArchonStatusCommand(pi, ctx);
  }
}

abstract class CleanupCmd extends ArchonCommand {
  static override meta: SubCommandMeta = {
    name: "cleanup",
    aliases: ["clean"],
    description: "Prune worktrees, stale refs, sync submodules.",
    category: "Management",
    flags: [
      { name: "--verbose", aliases: ["-v"], type: "boolean", description: "Verbose output" },
      { name: "--dry-run", type: "boolean", description: "Preview without applying changes" },
    ],
    examples: ["/archon manage cleanup --verbose"],
  };
  async execute(pi: ExtensionAPI, args: string[], ctx: ExtensionCommandContext): Promise<void> {
    await handleArchonCleanupCommand(pi, args.filter((a) => a !== "help" && a !== "-h" && a !== "--help"), ctx);
  }
}

abstract class SyncSubmodulesCmd extends ArchonCommand {
  static override meta: SubCommandMeta = {
    name: "sync-submodules",
    description: "Fetch + prune submodule remotes.",
    category: "Management",
    examples: ["/archon manage sync-submodules"],
  };
  async execute(pi: ExtensionAPI, args: string[], ctx: ExtensionCommandContext): Promise<void> {
    if (this.showHelpIfRequested(pi, args)) return;
    await handleArchonSyncSubmodulesCommand(pi, args, ctx);
  }
}

// ─── Server group (composite with children) ─────────────────────

abstract class ServerStartCmd extends ArchonCommand {
  static override meta: SubCommandMeta = {
    name: "start",
    description: "Start the Archon backend API server.",
    category: "Server",
    examples: ["/archon server start"],
  };
  async execute(pi: ExtensionAPI, args: string[], ctx: ExtensionCommandContext): Promise<void> {
    await handleArchonServerCommand(pi, ["start", ...args], ctx);
  }
}

abstract class ServerStopCmd extends ArchonCommand {
  static override meta: SubCommandMeta = {
    name: "stop",
    description: "Stop the Archon backend API server.",
    category: "Server",
    examples: ["/archon server stop"],
  };
  async execute(pi: ExtensionAPI, args: string[], ctx: ExtensionCommandContext): Promise<void> {
    await handleArchonServerCommand(pi, ["stop", ...args], ctx);
  }
}

abstract class ServerStatusCmd extends ArchonCommand {
  static override meta: SubCommandMeta = {
    name: "status",
    description: "Check server health.",
    category: "Server",
    examples: ["/archon server status"],
  };
  async execute(pi: ExtensionAPI, args: string[], ctx: ExtensionCommandContext): Promise<void> {
    await handleArchonServerCommand(pi, ["status", ...args], ctx);
  }
}

// ─── Web Dev group (composite with children) ────────────────────

abstract class WebStartCmd extends ArchonCommand {
  static override meta: SubCommandMeta = {
    name: "start",
    description: "Start the Archon web frontend.",
    category: "Web Dev",
    flags: [
      { name: "--assistant", type: "string", description: "Assistant identifier (default from config)" },
      { name: "--open", type: "boolean", description: "Open browser after start" },
    ],
    examples: ["/archon web start --assistant pi"],
  };
  async execute(pi: ExtensionAPI, args: string[], ctx: ExtensionCommandContext): Promise<void> {
    await handleArchonWebCommand(pi, ["start", ...args], ctx);
  }
}

abstract class WebStopCmd extends ArchonCommand {
  static override meta: SubCommandMeta = {
    name: "stop",
    description: "Stop running Archon web frontend processes.",
    category: "Web Dev",
    examples: ["/archon web stop"],
  };
  async execute(pi: ExtensionAPI, args: string[], ctx: ExtensionCommandContext): Promise<void> {
    await handleArchonWebCommand(pi, ["stop", ...args], ctx);
  }
}

abstract class WebStatusCmd extends ArchonCommand {
  static override meta: SubCommandMeta = {
    name: "status",
    description: "Check web frontend health.",
    category: "Web Dev",
    examples: ["/archon web status"],
  };
  async execute(pi: ExtensionAPI, args: string[], ctx: ExtensionCommandContext): Promise<void> {
    await handleArchonWebCommand(pi, ["status", ...args], ctx);
  }
}

// ─── Group definitions ──────────────────────────────────────────

const workflowsGroup: CommandGroupMeta = {
  name: "workflow",
  aliases: ["workflows", "plan"],
  description: "AI-driven planning and implementation.",
  category: "Workflows",
  children: [PlanCmd.meta, ImplementCmd.meta, ValidateCmd.meta],
};

const managementGroup: CommandGroupMeta = {
  name: "manage",
  aliases: ["management", "status", "cleanup", "clean", "sync-submodules"],
  description: "Project status, cleanup, and submodule maintenance.",
  category: "Management",
  children: [StatusCmd.meta, CleanupCmd.meta, SyncSubmodulesCmd.meta],
};

const serverGroup: CommandGroupMeta = {
  name: "server",
  aliases: ["api"],
  description: "Manage the @archon/server backend API.",
  category: "Server",
  children: [ServerStartCmd.meta, ServerStopCmd.meta, ServerStatusCmd.meta],
};

const webGroup: CommandGroupMeta = {
  name: "web",
  aliases: [],
  description: "Manage the @archon/web frontend (requires separate /archon server start).",
  category: "Web Dev",
  children: [WebStartCmd.meta, WebStopCmd.meta, WebStatusCmd.meta],
};

// ════════════════════════════════════════════════════════════════
// Top-level command tree — single source of truth for dispatch
// ════════════════════════════════════════════════════════════════

export const archonTree: CommandGroupMeta = {
  name: "archon",
  description: "Archon workspace launcher",
  category: "",
  children: [
    workflowsGroup,
    managementGroup,
    serverGroup,
    webGroup,
  ],
};

// ─── Collect all leaf metadata (for help rendering) ──────────────

/** Completion item produced for pi's argument-completion UI */
export interface CompletionItem {
  value: string;
  label: string;
}

/** Build the full completion list from the live command tree.
 * Includes every group name, every leaf invocation, and the help tokens.
 * Callers should filter this against the user-typed prefix before returning. */
export function buildCompletions(): CompletionItem[] {
  const items: CompletionItem[] = [];
  collect(archonTree.children, "", items);
  // Append generic help triggers
  items.push(
    { value: "-h", label: "Show per-command help" },
    { value: "--help", label: "Show per-command help (long form)" },
    { value: "help", label: "Show full help" },
  );
  return items;
}

function collect(nodes: Array<SubCommandMeta | CommandGroupMeta>, parentPath: string, out: CompletionItem[]): void {
  for (const n of nodes) {
    if (isGroup(n)) {
      const groupValue = `${parentPath}${n.name}`.trim();
      // Emit the canonical group name
      out.push({ value: groupValue, label: n.description || groupValue });
      // Emit each alias so shortcuts like `/archon status` complete correctly
      for (const alias of n.aliases ?? []) {
        const aliasValue = `${parentPath}${alias}`.trim();
        out.push({ value: aliasValue, label: `${n.description} (alias)` });
      }
      collect(n.children, `${groupValue} `, out);
    } else {
      const leafValue = `${parentPath}${n.name}`.trim();
      const argHints = n.args?.filter((a) => a.required).map((a) => `<${a.name}>`).join(" ") ?? "";
      const displayValue = argHints ? `${leafValue} ${argHints}` : leafValue;
      out.push({ value: displayValue, label: n.description || displayValue });
      // Also emit aliases at this depth
      for (const alias of n.aliases ?? []) {
        const aliasValue = `${parentPath}${alias}`.trim();
        out.push({ value: aliasValue, label: `${n.description} (alias)` });
      }
    }
  }
}

/** Return every leaf sub-command in the tree, with `name` set to the full invocation path */
export function getAllLeaves(): SubCommandMeta[] {
  const leaves: SubCommandMeta[] = [];
  walk(archonTree.children, leaves, "");
  return leaves;
}

function walk(nodes: Array<SubCommandMeta | CommandGroupMeta>, out: SubCommandMeta[], prefix: string): void {
  for (const n of nodes) {
    if (isGroup(n)) {
      walk(n.children, out, `${prefix}${n.name} `);
    } else {
      // Push a copy so the original static meta stays untouched; replace name with full path.
      out.push({ ...n, name: `${prefix}${n.name}`.trim() });
    }
  }
}

// ─── Build handler map keyed by canonical path ──────────────────

const handlers = new Map<string, InstanceType<typeof ArchonCommand>>([
  ["workflow:plan",      new (class extends PlanCmd {})()],
  ["workflow:implement", new (class extends ImplementCmd {})()],
  ["workflow:validate",  new (class extends ValidateCmd {})()],
  ["manage:status",      new (class extends StatusCmd {})()],
  ["manage:cleanup",     new (class extends CleanupCmd {})()],
  ["manage:sync-submodules", new (class extends SyncSubmodulesCmd {})()],
  ["server:start",       new (class extends ServerStartCmd {})()],
  ["server:stop",        new (class extends ServerStopCmd {})()],
  ["server:status",      new (class extends ServerStatusCmd {})()],
  ["web:start",          new (class extends WebStartCmd {})()],
  ["web:stop",           new (class extends WebStopCmd {})()],
  ["web:status",         new (class extends WebStatusCmd {})()],
]);

export function getHandler(path: string): ArchonCommand | undefined {
  return handlers.get(path.toLowerCase());
}

// ─── Resolve tokens → handler + remaining args ────────────────────

export interface DispatchResult {
  handler?: ArchonCommand;
  path: string;
  rest: string[];
  meta?: SubCommandMeta | CommandGroupMeta;
}

let _lastMatchedGroup: CommandGroupMeta | undefined;

export function resolveTokens(tokens: string[]): DispatchResult {
  let cursor: Array<SubCommandMeta | CommandGroupMeta> = archonTree.children;
  const pathParts: string[] = [];
  _lastMatchedGroup = undefined;

  while (tokens.length) {
    const token = tokens.shift()!;
    const lower = token.toLowerCase();
    const match = cursor.find((c) => c.name.toLowerCase() === lower || (c.aliases ?? []).some((a) => a.toLowerCase() === lower));

    if (!match) {
      // No further match — return what we have so far with remainder
      return { path: pathParts.join(":"), rest: [token, ...tokens], meta: _lastMatchedGroup };
    }

    pathParts.push(match.name);

    if (isGroup(match)) {
      // Composite group — remember it in case tokens exhaust here
      _lastMatchedGroup = match;
      cursor = match.children;
    } else {
      // Leaf node reached
      return {
        handler: getHandler(pathParts.join(":")),
        path: pathParts.join(":"),
        meta: match,
        rest: [...tokens],
      };
    }
  }

  // Exhausted tokens on a composite group — return the matched group metadata
  // so the caller can render its scoped help instead of falling to legacy dispatch.
  return { path: pathParts.join(":"), rest: [], meta: _lastMatchedGroup };
}

// ════════════════════════════════════════════════════════════════
// Help generation helpers (used by the central router)
// ════════════════════════════════════════════════════════════════

const HELP_TOKENS = new Set(["help", "-h", "--help"]);

/** Check whether any token in `args` triggers help */
export function isHelpTrigger(args: string[]): boolean {
  return args.some((a) => HELP_TOKENS.has(a.toLowerCase()));
}

/** Generate full top-level help markdown from metadata tree */
export function generateFullHelp(): string {
  return ["## Archon", "", ArchonCommand.renderHelpFor(getAllLeaves()), ""].join("\n");
}

/** Generate scoped help for one sub-command or leaf */
export function generateScopedHelp(node: SubCommandMeta): string {
  const lines: string[] = [`## /archon ${node.name}`, "", node.description];

  if (node.args?.length) {
    lines.push("", "### Arguments");
    for (const arg of node.args) {
      const req = arg.required ? " *(required)*" : "";
      lines.push(`- \`${arg.name}\`${req}: ${arg.description ?? ""}`);
    }
  }

  if (node.flags?.length) {
    lines.push("", "### Flags");
    for (const flag of node.flags) {
      const aliasStr = flag.aliases?.map((a) => `${a}, `).join("") ?? "";
      lines.push(`- ${aliasStr}\`${flag.name}\`: ${flag.description ?? ""}`);
    }
  }

  if (node.examples?.length) {
    lines.push("", "### Examples");
    for (const ex of node.examples) {
      lines.push(`\`\`\`bash`, ex, "\`\`\`");
    }
  }

  lines.push("");
  return lines.join("\n");
}

/** Generate scoped help for a command group showing its children */
export function generateGroupHelp(group: CommandGroupMeta): string {
  const lines: string[] = [
    `## /archon ${group.name}`,
    "",
    group.description,
    "",
    "### Sub-commands",
    "",
  ];

  for (const child of group.children) {
    const nameToken = child.name + (isGroup(child) ? " <sub>" : "");
    lines.push(`- \`${nameToken}\` — ${child.description}`);
  }

  lines.push("");
  return lines.join("\n");
}


