import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import * as fs from "node:fs";
import { ARCHON_ROOT, DEFAULT_QUERY } from "./constants";
import type { WorkflowName } from "./types";
import { createMessageEmitter, formatElapsed, normalizeString } from "./helpers";
import { redactSecrets, safeCode } from "./output-filter";
import { formatArchonToolResult, runArchonCommand } from "./archon-exec";
import { handleWorkflowCommand } from "./archon-workflow-cmd";
// ─── Status subcommand (workflow-aware) ─────────

type ArchonWorkflowStatusRow = {
  id: string;
  workflow_name: string;
  working_path?: string | null;
  status: string;
  started_at: string;
};

type ArchonWorkflowStatusJson = {
  runs: ArchonWorkflowStatusRow[];
};

function extractJsonObjects(raw: string): string[] {
  const objects: string[] = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaping = false;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];

    if (inString) {
      if (escaping) {
        escaping = false;
        continue;
      }
      if (ch === "\\") {
        escaping = true;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === "{") {
      if (depth === 0) start = i;
      depth += 1;
      continue;
    }

    if (ch === "}") {
      if (depth > 0) depth -= 1;
      if (depth === 0 && start >= 0) {
        objects.push(raw.slice(start, i + 1));
        start = -1;
      }
    }
  }

  return objects;
}

function parseWorkflowStatusJson(rawOut: string, rawErr: string): ArchonWorkflowStatusJson {
  const combined = [rawOut, rawErr].filter(Boolean).join("\n");
  const jsonObjects = extractJsonObjects(combined);
  if (jsonObjects.length === 0) throw new Error("No JSON payload found in workflow status output.");
  for (const jsonBlock of jsonObjects) {
    try {
      const parsed = JSON.parse(jsonBlock) as ArchonWorkflowStatusJson;
      if (parsed && Array.isArray(parsed.runs)) return parsed;
    } catch { /* keep scanning */ }
  }
  throw new Error("Malformed workflow status JSON (missing runs array).");
}

function formatAge(startedAt: string): string {
  const parsed = new Date(startedAt.endsWith("Z") ? startedAt : `${startedAt}Z`);
  if (Number.isNaN(parsed.getTime())) return "unknown";
  return formatElapsed(Math.floor((Date.now() - parsed.getTime()) / 1000));
}

function renderWorkflowStatus(projectRoot: string, runs: ArchonWorkflowStatusRow[]): string {
  const localRuns = runs.filter((run) => (run.working_path ?? "") === projectRoot);
  const lines: string[] = [
    "## Archon workflow status",
    "",
    `- **Project:** \`${safeCode(projectRoot)}\``,
    `- **Archon root:** \`${safeCode(ARCHON_ROOT)}\` ${fs.existsSync(`${ARCHON_ROOT}/package.json`) ? "(found)" : "(missing)"}`,
    `- **Active runs:** ${runs.length}`,
    `- **On this path:** ${localRuns.length}`,
    "",
  ];

  if (runs.length === 0) {
    lines.push("No active workflows.", "");
    return lines.join("\n");
  }

  lines.push("### Runs", "");
  for (const run of runs) {
    const here = (run.working_path ?? "") === projectRoot ? " **(this path)**" : "";
    lines.push(`- \`${run.id}\` — **${safeCode(run.workflow_name)}** · ${safeCode(run.status)} · age ${formatAge(run.started_at)}${here}`);
    lines.push(`  - path: \`${safeCode(run.working_path ?? "(none)")}\``);
    lines.push(`  - cancel: \`/archon manage cancel ${safeCode(run.id)}\``);
  }
  lines.push("");
  return lines.join("\n");
}

export async function handleArchonStatusCommand(pi: ExtensionAPI, ctx: ExtensionCommandContext): Promise<void> {
  const projectRoot = ctx.cwd || process.cwd();
  try {
    const run = await runArchonCommand(pi, ["workflow", "status", "--json"], projectRoot);
    if (run.exitCode !== 0) throw new Error(run.stderr || run.stdout || `exit ${run.exitCode}`);
    const parsed = parseWorkflowStatusJson(run.stdout || "", run.stderr || "");
    emitArchon(pi, renderWorkflowStatus(projectRoot, parsed.runs ?? []), { action: "workflow_status", runs: parsed.runs?.length ?? 0 });
  } catch (error) {
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
      ["## Archon status", "", `- **Project:** \`${safeCode(projectRoot)}\``,
        `- **Archon root:** \`${safeCode(ARCHON_ROOT)}\` ${fs.existsSync(`${ARCHON_ROOT}/package.json`) ? "(found)" : "(missing)"}`,
        `- **Workflows:** ${workflows.length ? workflows.map((w) => `\`${safeCode(w)}\``).join(", ") : "none"}`,
        `- **Agents:** ${agents.length ? agents.map((a) => `\`${safeCode(a.replace(/\.md$/, ""))}\``).join(", ") : "none"}`,
        `- **Workflow DB status:** failed to query (${safeCode(String(error instanceof Error ? error.message : error))})`,
        ""
      ].join("\n")
    );
  }
}

export async function handleArchonWorkflowCancelCommand(pi: ExtensionAPI, runId: string, ctx: ExtensionCommandContext): Promise<void> {
  const projectRoot = ctx.cwd || process.cwd();
  try {
    const run = await runArchonCommand(pi, ["workflow", "abandon", runId], projectRoot);
    if (run.exitCode !== 0) throw new Error(run.stderr || run.stdout || `exit ${run.exitCode}`);
    emitArchon(pi, `## Archon workflow cancelled\n\n- **Run:** \`${safeCode(runId)}\`\n\n\`\`\`text\n${safeCode((run.stdout || run.stderr || "Cancelled.").trim())}\n\`\`\`\n`, { action: "workflow_cancel", runId });
    ctx.ui.notify(`Archon workflow ${runId} cancelled.`, "info");
  } catch (error) {
    const message = String(error instanceof Error ? error.message : error);
    emitArchon(pi, `## Archon workflow cancel failed\n\n- **Run:** \`${safeCode(runId)}\`\n- **Error:** ${safeCode(message)}\n`, { action: "workflow_cancel", runId, error: message });
    ctx.ui.notify(`Archon workflow ${runId} cancel failed.`, "warning");
  }
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
  const resolvedQuery = maybeString(query) || DEFAULT_QUERY;
  let result;
  try {
    result = await runArchonCommand(api, ["workflow", "run", workflow, resolvedQuery, "--no-worktree"], cwd);
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
  return { content: [{ type: "text", text: ["## Archon status", "", `- **Project:** \`${safeCode(cwd)}\``, `- **Archon root:** \`${safeCode(ARCHON_ROOT)}\` ${fs.existsSync(`${ARCHON_ROOT}/package.json`) ? "(found)" : "(missing)"}`, `- **Workflows:** ${workflows}`, `- **Agents:** ${agents}`].join("\n") }], details: { action: "status_fallback" } };
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
  if (firstToken === "cancel" || firstToken === "abandon") {
    const runId = tokens[1];
    if (!runId) {
      emitArchon(pi, "## Archon\n\n- **Missing run id**\n\n```bash\n/archon cancel <runId>\n```\n");
      return;
    }
    return await handleArchonWorkflowCancelCommand(pi, runId, ctx);
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
    "- `/archon status` — Show active Archon workflow runs.",
    "- `/archon cancel <runId>` — Cancel active workflow run by id.",
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
