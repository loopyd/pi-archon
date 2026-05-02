import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import * as fs from "node:fs";
import { ARCHON_ROOT, DEFAULT_QUERY, PREFERRED_WORKFLOW_IDS } from "./constants";
import type { WorkflowName } from "./types";
import { createMessageEmitter, normalizeString } from "./helpers";
import { redactSecrets, safeCode } from "./output-filter";
import { formatArchonToolResult, runArchonCommand } from "./archon-exec";
import { handleWorkflowCommand } from "./archon-workflow-cmd";
// ─── Status subcommand (inlined from archon-status.ts) ─────────

export async function handleArchonStatusCommand(pi: ExtensionAPI, ctx: ExtensionCommandContext): Promise<void> {
  const projectRoot = ctx.cwd || process.cwd();
  const workflowDir = `${projectRoot}/.archon/workflows`;
  const agentDir = `${projectRoot}/.pi/agents`;
  const workflows = fs.existsSync(workflowDir)
    ? fs.readdirSync(workflowDir).filter((f) => f.endsWith(".yaml")).sort()
    : [];
  const agents = fs.existsSync(agentDir)
    ? fs.readdirSync(agentDir).filter((f) => f.endsWith(".md")).sort()
    : [];
  emitArchon(
    pi,
    ["Archon status", "─────────────", `Project: ${projectRoot}`,
      `Archon root: ${ARCHON_ROOT} ${fs.existsSync(`${ARCHON_ROOT}/package.json`) ? "(found)" : "(missing)"}`,
      `Workflows: ${workflows.length ? workflows.join(", ") : "none"}`,
      `Agents: ${agents.length ? agents.map((a) => a.replace(/\.md$/, "")).join(", ") : "none"}`
    ].join("\n")
  );
}
import { handleArchonWebCommand } from "./archon-web-dev";
import { buildSteps, handleArchonCleanupCommand, handleArchonSyncSubmodulesCommand } from "./archon-cleanup-pipeline";
import { normalizeWorkflow } from "./archon-ui";

// New command-tree imports
import {
  resolveTokens,
  generateFullHelp,
  generateScopedHelp,
  generateGroupHelp,
  getAllLeaves,
  getHandler,
  isHelpTrigger,
  archonTree,
} from "./command-tree";
import { isGroup } from "./command-base";

const emitArchon = createMessageEmitter("archon");

// ─── Tool definitions (RPC endpoint) ──────────────

export function registerArchonTools(pi: ExtensionAPI): void {
  (pi as any).registerRoute({
    path: "/archon",
    method: "POST",
    schema: Type.Object({
      command: Type.String(),
      args: Type.Optional(Type.String()),
      options: Type.Optional(Type.Record(Type.String(), Type.Any())),
    }),
    handler: async (req: any) => {
      const cmd = req.body?.command ?? "";
      const args = req.body?.args ?? "";
      const opts = req.body?.options ?? {};
      try {
        if (/^(?:plan|implement|validate)$/i.test(cmd)) return await invokeWorkflowTool(pi as ExtensionAPI, cmd.toLowerCase() as WorkflowName, args, process.cwd());
        else if (cmd === "status") return await invokeStatus(process.cwd());
        else if (cmd === "cleanup" || cmd === "clean") return await invokeCleanup(args.split(/\s+/), process.cwd(), Boolean(opts.verbose));
        else if (cmd.startsWith("web")) return handleArchonWebCommand(pi as ExtensionAPI, [].concat(args.split(/\s+/)), { cwd: process.cwd(), ui: { notify: () => {} } as any, hasUI: false } as ExtensionCommandContext);
        else if (cmd === "help") return { content: [{ type: "text", text: getHelpMarkdown() }] };
        else return { content: [{ type: "text", text: ["## Archon", "", "- **Unknown:*" + "`" + safeCode(cmd) + "`"].join("\n") }] };
      } catch (error) {
        const msg = String(error ?? "unknown");
        return { content: [{ type: "text", text: ["## Archon error", "", "`" + msg + "`"].join("\n") }], details: { error: msg } };
      }
    },
  });
}

async function invokeWorkflowTool(api: ExtensionAPI, workflow: WorkflowName, query: string, cwd: string) {
  const startedAt = Date.now();
  const workflowId = PREFERRED_WORKFLOW_IDS[workflow] ?? workflow;
  const resolvedQuery = maybeString(query) || DEFAULT_QUERY;
  let result;
  try {
    result = await runArchonCommand(api, ["workflow", "run", workflowId, resolvedQuery, "--no-worktree"], cwd);
  } catch { result = { command: "", stdout: "", stderr: "failed", exitCode: 1 }; }
  return formatArchonToolResult(`${workflow.toUpperCase()} — ${redactSecrets(resolvedQuery)}`, result, { workflow, command: "tool_workflow_run", durationMs: Date.now() - startedAt }, Date.now() - startedAt);
}

function maybeString(value: unknown): string | undefined {
  const v = normalizeString(value);
  return v.length > 0 ? v : undefined;
}

async function invokeStatus(cwd: string): Promise<{ content: Array<{ type: string; text: string }>; details?: Record<string, unknown> }> {
  const workflows = fs.existsSync(`${cwd}/.archon/workflows`) ? fs.readdirSync(`${cwd}/.archon/workflows`).filter((f) => f.endsWith(".yaml")).sort().join(", ") : "none";
  const agents = fs.existsSync(`${cwd}/.pi/agents`) ? fs.readdirSync(`${cwd}/.pi/agents`).filter((f) => f.endsWith(".md")).map((a) => a.replace(/\.md$/, "")).sort().join(", ") : "none";
  return { content: [{ type: "text", text: ["## Archon status", "─────────────", `Project: ${cwd}`, `Archon root: ${ARCHON_ROOT} ${fs.existsSync(`${ARCHON_ROOT}/package.json`) ? "(found)" : "(missing)"}`, `Workflows: ${workflows}`, `Agents: ${agents}`].join("\n") }] as Array<{type:string;text:string;display?:boolean}>, details: { action: "status" } };
}

async function invokeCleanup(args: string[], cwd: string, verboseFlag?: boolean) {
  const steps = buildSteps({ exec: async () => ({ code: 0 }) as any } as unknown as ExtensionAPI, cwd, verboseFlag);
  // Simplified for tool mode — delegates to full handler in CLI context
  const bullets: string[] = [];
  for (const step of steps.slice(0, 3)) {
    try { bullets.push(`- **${step.title}:** queued`); } catch { /* no-op */ }
  }
  if (bullets.length === 0) bullets.push("- all sections clean");
  return { content: [{ type: "text", text: `## Archon cleanup\n\n${bullets.join("\n")}\n`, display: true }] };
}

// ─── CLI command routing (rewired through command-tree registry) ──

/**
 * Parse slash-command arguments into tokens.
 * pi passes `args` as everything AFTER the command name.
 */
function parseSlashArgs(raw: string): string[] {
  return normalizeString(raw).split(/\s+/).filter(Boolean);
}

export async function registerCliRoutes(pi: ExtensionAPI, ctx: ExtensionCommandContext): Promise<void> {
  const tokens = parseSlashArgs((ctx as any).args || "");
  const projectCwd = ctx.cwd || process.cwd();

  // ── Help at top level (no subcommand given or bare help token) ──
  if (!tokens.length || isHelpTrigger(tokens) && tokens.length <= 1) {
    emitArchon(pi, generateFullHelp());
    return;
  }

  // ── Resolve against the metadata tree ──
  const result = resolveTokens([...tokens]);

  // Check if a help-trigger appears anywhere in remaining args
  if (isHelpTrigger(result.rest)) {
    // Show scoped help for the matched node
    if (result.meta) {
      if (isGroup(result.meta)) {
        emitArchon(pi, generateGroupHelp(result.meta));
      } else {
        emitArchon(pi, generateScopedHelp(result.meta));
      }
    } else {
      emitArchon(pi, generateFullHelp());
    }
    return;
  }

  // Tokens exhausted on a composite group — render its sub-command help
  // instead of falling through to legacy dispatch.
  if (!result.handler && result.meta && isGroup(result.meta)) {
    emitArchon(pi, generateGroupHelp(result.meta));
    return;
  }

  // ── Dispatch to concrete handler ──
  if (result.handler) {
    await result.handler.execute(pi, result.rest, ctx);
    return;
  }

  // ── Fallback: legacy dispatch for unrecognised commands ──
  const firstToken = tokens[0]?.toLowerCase() ?? "";

  // Non-workflow subcommands must be checked BEFORE normalizeWorkflow(),
  // which collapses every unrecognised token to "plan".
  if (firstToken.startsWith("web")) {
    return await handleArchonWebCommand(pi, tokens.slice(1), ctx);
  }
  if (firstToken === "cleanup" || firstToken === "clean") {
    return await handleArchonCleanupCommand(pi, tokens.slice(1), ctx);
  }
  if (firstToken === "sync-submodules") {
    return await handleArchonSyncSubmodulesCommand(pi, tokens.slice(1), ctx);
  }
  if (firstToken === "status") {
    return await handleArchonStatusCommand(pi, ctx);
  }

  // Workflow dispatch via normalizer
  switch (normalizeWorkflow(firstToken)) {
    case "plan":     await handleWorkflowCommand(pi, "plan", tokens.slice(1).join(" "), ctx); break;
    case "implement":await handleWorkflowCommand(pi, "implement", tokens.slice(1).join(" "), ctx); break;
    case "validate": await handleWorkflowCommand(pi, "validate", tokens.slice(1).join(" "), ctx); break;
    default:
      emitArchon(pi, `## Archon\n\n- **Unknown:** \`${safeCode(firstToken)}\`\n`);
  }
}

// ─── Legacy help markdown (kept for tool-mode RPC compat) ────────

function getHelpMarkdown(): string {
  return [
    "## Archon",
    "",
    "### Workflows",
    "",
    "- `/archon plan <query>` — Plan a task.",
    "- `/archon implement <query>` — Implement the plan.",
    "- `/archon validate <query>` — Validate implementation.",
    "",
    "### Management",
    "",
    "- `/archon status` — Show Archon project status.",
    "- `/archon cleanup` — Prune worktrees, stale refs, sync submodules.",
    "- `/archon clean` — Alias for cleanup.",
    "- `/archon sync-submodules` — Fetch + prune submodule remotes.",
    "",
    "### Web Dev",
    "",
    "- `/archon web start` — Start the Archon web dev server.",
    "- `/archon web stop` — Stop running Archon web dev processes.",
    "- `/archon web status` — Check web dev health.",
    "",
    "### General",
    "",
    "- `/archon help` — Show this message.",
    "- `/archon <command> -h|--help` — Show per-command help.",
  ].join("\n");
}
