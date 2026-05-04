import * as fs from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ARCHON_ROOT, EXEC_TIMEOUT_MS } from "./constants";

interface WorkflowListJsonEntry {
  name?: string;
}

interface WorkflowListJsonResult {
  workflows?: WorkflowListJsonEntry[];
}

const execFileAsync = promisify(execFile);

const projectWorkflowCache = new Map<string, Promise<string[]>>();
const projectWorkflowSnapshot = new Map<string, string[]>();

function resolveArchonCli(projectCwd: string): { command: string; args: string[]; cwd: string } {
  const cmdArgs = ["workflow", "list", "--json", "--cwd", projectCwd];
  if (fs.existsSync(`${ARCHON_ROOT}/package.json`)) {
    return { command: "bun", args: ["run", "cli", ...cmdArgs], cwd: ARCHON_ROOT };
  }
  return { command: "archon", args: cmdArgs, cwd: projectCwd };
}

function parseWorkflowListJson(stdout: string): string[] {
  const trimmed = stdout.trim();
  if (!trimmed) throw new Error("Empty Archon workflow list output");

  for (const line of trimmed.split(/\r?\n/)) {
    const candidate = line.trim();
    if (!candidate.startsWith("{")) continue;
    try {
      const payload = JSON.parse(candidate) as WorkflowListJsonResult;
      if (!Array.isArray(payload.workflows)) continue;
      return payload.workflows
        .map((entry) => entry.name)
        .filter((name): name is string => typeof name === "string" && name.length > 0)
        .sort();
    } catch {}
  }

  const start = trimmed.indexOf('{\n  "workflows"');
  if (start < 0) throw new Error("Archon workflow list output did not contain workflow JSON");

  const payload = JSON.parse(trimmed.slice(start)) as WorkflowListJsonResult;
  return (payload.workflows ?? [])
    .map((entry) => entry.name)
    .filter((name): name is string => typeof name === "string" && name.length > 0)
    .sort();
}

async function loadProjectWorkflowNames(projectCwd: string): Promise<string[]> {
  const inv = resolveArchonCli(projectCwd);
  const result = await execFileAsync(inv.command, inv.args, {
    cwd: inv.cwd,
    timeout: EXEC_TIMEOUT_MS,
    env: process.env,
    maxBuffer: 1024 * 1024,
  });
  return parseWorkflowListJson(result.stdout);
}

export async function listProjectWorkflowNames(projectCwd?: string): Promise<string[]> {
  const cwd = projectCwd || process.cwd();
  const cached = projectWorkflowCache.get(cwd);
  if (cached) return cached;
  const pending = loadProjectWorkflowNames(cwd)
    .then((names) => {
      projectWorkflowSnapshot.set(cwd, names);
      return names;
    })
    .catch((error) => {
      projectWorkflowCache.delete(cwd);
      throw error;
    });
  projectWorkflowCache.set(cwd, pending);
  return pending;
}

export function peekProjectWorkflowNames(projectCwd?: string): string[] {
  const cwd = projectCwd || process.cwd();
  return projectWorkflowSnapshot.get(cwd) ?? [];
}

export function readProjectWorkflowNamesFromDisk(projectCwd?: string): string[] {
  const cwd = projectCwd || process.cwd();
  const dir = `${cwd}/.archon/workflows`;
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((name) => /\.ya?ml$/i.test(name))
    .map((name) => name.replace(/\.ya?ml$/i, ""))
    .sort();
}

export async function refreshProjectWorkflowNames(projectCwd?: string): Promise<string[]> {
  const cwd = projectCwd || process.cwd();
  clearProjectWorkflowCache(cwd);
  try {
    return await listProjectWorkflowNames(cwd);
  } catch {
    const names = readProjectWorkflowNamesFromDisk(cwd);
    projectWorkflowSnapshot.set(cwd, names);
    return names;
  }
}

export async function findProjectWorkflow(name: string, projectCwd?: string): Promise<string | undefined> {
  const cwd = projectCwd || process.cwd();
  const lowerName = name.toLowerCase();
  const cached = await listProjectWorkflowNames(cwd);
  const cachedMatch = cached.find((entry) => entry.toLowerCase() === lowerName);
  if (cachedMatch) return cachedMatch;
  const refreshed = await refreshProjectWorkflowNames(cwd);
  return refreshed.find((entry) => entry.toLowerCase() === lowerName);
}

export function clearProjectWorkflowCache(projectCwd?: string): void {
  if (projectCwd) {
    projectWorkflowCache.delete(projectCwd);
    projectWorkflowSnapshot.delete(projectCwd);
    return;
  }
  projectWorkflowCache.clear();
  projectWorkflowSnapshot.clear();
}
