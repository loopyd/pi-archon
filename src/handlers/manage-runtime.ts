import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import * as fs from "node:fs";
import { ARCHON_PILL_MANAGE, ARCHON_ROOT, ARCHON_STATUS_TITLE } from "../constants";
import { emitArchonMessage, formatElapsed } from "../helpers";
import { safeCode } from "../output-filter";
import { runArchonCommand } from "../archon-exec";


export type ArchonWorkflowStatusRow = {
  id: string;
  workflow_name: string;
  working_path?: string | null;
  status: string;
  started_at: string;
};

export type ArchonWorkflowStatusJson = {
  runs: ArchonWorkflowStatusRow[];
};

function archonRootStatus(): string {
  return `\`${safeCode(ARCHON_ROOT)}\` ${fs.existsSync(`${ARCHON_ROOT}/package.json`) ? "(found)" : "(missing)"}`;
}

function listProjectFiles(dir: string, suffix: string): string[] {
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter((name) => name.endsWith(suffix)).sort() : [];
}

function formatBulletList(values: string[], map: (value: string) => string = (value) => value): string {
  return values.length > 0 ? values.map((value) => `\`${safeCode(map(value))}\``).join(", ") : "none";
}

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

export function parseWorkflowStatusJson(rawOut: string, rawErr: string): ArchonWorkflowStatusJson {
  const combined = [rawOut, rawErr].filter(Boolean).join("\n");
  const jsonObjects = extractJsonObjects(combined);
  if (jsonObjects.length === 0) throw new Error("No JSON payload found in workflow status output.");
  for (const jsonBlock of jsonObjects) {
    try {
      const parsed = JSON.parse(jsonBlock) as ArchonWorkflowStatusJson;
      if (parsed && Array.isArray(parsed.runs)) return parsed;
    } catch {}
  }
  throw new Error("Malformed workflow status JSON (missing runs array).");
}

function renderWorkflowStatus(projectRoot: string, runs: ArchonWorkflowStatusRow[]): string {
  const localRuns = runs.filter((run) => (run.working_path ?? "") === projectRoot);
  const lines: string[] = [
    "## Archon workflow status",
    "",
    `- **Project:** \`${safeCode(projectRoot)}\``,
    `- **Archon root:** ${archonRootStatus()}`,
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
    const startedAt = new Date(run.started_at.endsWith("Z") ? run.started_at : `${run.started_at}Z`);
    const age = Number.isNaN(startedAt.getTime()) ? "unknown" : formatElapsed(Math.floor((Date.now() - startedAt.getTime()) / 1000));
    lines.push(`- \`${run.id}\` — **${safeCode(run.workflow_name)}** · ${safeCode(run.status)} · age ${age}${here}`);
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
    emitArchonMessage(pi, renderWorkflowStatus(projectRoot, parsed.runs ?? []), { action: "workflow_status", runs: parsed.runs?.length ?? 0, pill: ARCHON_PILL_MANAGE });
  } catch (error) {
    const workflowDir = `${projectRoot}/.archon/workflows`;
    const agentDir = `${projectRoot}/.pi/agents`;
    const workflows = listProjectFiles(workflowDir, ".yaml");
    const agents = listProjectFiles(agentDir, ".md");
    emitArchonMessage(pi, [
      ARCHON_STATUS_TITLE,
      "",
      `- **Project:** \`${safeCode(projectRoot)}\``,
      `- **Archon root:** ${archonRootStatus()}`,
      `- **Workflows:** ${formatBulletList(workflows)}`,
      `- **Agents:** ${formatBulletList(agents, (agent) => agent.replace(/\.md$/, ""))}`,
      `- **Workflow DB status:** failed to query (${safeCode(String(error instanceof Error ? error.message : error))})`,
      "",
    ].join("\n"), { pill: ARCHON_PILL_MANAGE });
  }
}

export async function cancelArchonWorkflowRun(pi: ExtensionAPI, runId: string, projectRoot: string): Promise<void> {
  const run = await runArchonCommand(pi, ["workflow", "abandon", runId], projectRoot);
  if (run.exitCode !== 0) throw new Error(run.stderr || run.stdout || `exit ${run.exitCode}`);
}

export async function findActiveWorkflowRunId(pi: ExtensionAPI, projectRoot: string, workflowName: string): Promise<string | undefined> {
  const run = await runArchonCommand(pi, ["workflow", "status", "--json"], projectRoot);
  if (run.exitCode !== 0) throw new Error(run.stderr || run.stdout || `exit ${run.exitCode}`);
  const parsed = parseWorkflowStatusJson(run.stdout || "", run.stderr || "");
  const candidates = (parsed.runs ?? []).filter((entry) =>
    (entry.working_path ?? "") === projectRoot &&
    entry.workflow_name === workflowName &&
    entry.status.toLowerCase() === "running"
  );
  const newest = candidates.sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at))[0];
  return newest?.id;
}

export async function handleArchonWorkflowCancelCommand(pi: ExtensionAPI, runId: string, ctx: ExtensionCommandContext): Promise<void> {
  const projectRoot = ctx.cwd || process.cwd();
  try {
    await cancelArchonWorkflowRun(pi, runId, projectRoot);
    emitArchonMessage(pi, `## Archon workflow cancelled\n\n- **Run:** \`${safeCode(runId)}\`\n`, { action: "workflow_cancel", runId, pill: ARCHON_PILL_MANAGE });
    ctx.ui.notify(`Archon workflow ${runId} cancelled.`, "info");
  } catch (error) {
    const message = String(error instanceof Error ? error.message : error);
    emitArchonMessage(pi, `## Archon workflow cancel failed\n\n- **Run:** \`${safeCode(runId)}\`\n- **Error:** ${safeCode(message)}\n`, { action: "workflow_cancel", runId, error: message, pill: ARCHON_PILL_MANAGE });
    ctx.ui.notify(`Archon workflow ${runId} cancel failed.`, "warning");
  }
}
