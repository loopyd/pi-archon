import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import * as fs from "node:fs";
import { basename } from "node:path";
import { getArchonServerUrl, getArchonWebUrl } from "../config";
import { ARCHON_DB_PATH, ARCHON_ROOT, RUNTIME_HEALTH_TIMEOUT_MS, RUNTIME_START_TIMEOUT_MS } from "../constants";
import type { ArchonWebStatusSnapshot, CodebaseBindingResult } from "../types";
import { sqlQuote } from "../helpers";
import { isHttpReachable, readLogTail } from "../runtime-util";

export async function execArchonSqlite(pi: ExtensionAPI, sql: string): Promise<string> {
  if (!fs.existsSync(ARCHON_DB_PATH)) throw new Error("Archon DB not found at " + ARCHON_DB_PATH);
  const result = await pi.exec("sqlite3", [ARCHON_DB_PATH, sql], { cwd: ARCHON_ROOT, timeout: RUNTIME_START_TIMEOUT_MS });
  if ((result.code ?? 0) !== 0) throw new Error(result.stderr || ("sqlite3 failed (exit " + String(result.code) + ")"));
  return (result.stdout ?? "").trim();
}

export function parseUiPortFromLog(logFile: string, fallbackPort: string): string {
  if (!fs.existsSync(logFile)) return fallbackPort;
  const matches = [...fs.readFileSync(logFile, "utf8").matchAll(/Local:\s+http:\/\/[^:\s]+:(\d+)\//g)];
  return matches.at(-1)?.[1] ?? fallbackPort;
}

export async function isWebFrontendReachable(projectCwd: string, port: string, timeoutMs = RUNTIME_HEALTH_TIMEOUT_MS): Promise<boolean> {
  return isHttpReachable(getArchonWebUrl(projectCwd, port).replace(/\/$/, ""), timeoutMs);
}

export async function readArchonWebStatus(
  projectCwd: string,
  logFile: string,
  defaultPort: string,
  statusLogLines: number,
  timeoutMs = RUNTIME_HEALTH_TIMEOUT_MS
): Promise<ArchonWebStatusSnapshot> {
  const port = parseUiPortFromLog(logFile, defaultPort);
  const [isHealthy, serverHealthy] = await Promise.all([
    isWebFrontendReachable(projectCwd, port, timeoutMs),
    isHttpReachable(`${getArchonServerUrl(projectCwd)}/api/health`, timeoutMs),
  ]);
  return {
    port,
    isHealthy,
    serverHealthy,
    logTail: readLogTail(logFile, statusLogLines),
  };
}

export async function ensureCodebaseAssistantBinding(
  pi: ExtensionAPI, projectCwd: string, assistant: string
): Promise<CodebaseBindingResult> {
  const query = `SELECT id || '|' || name || '|' || ai_assistant_type FROM remote_agent_codebases WHERE default_cwd = ${sqlQuote(projectCwd)} ORDER BY updated_at DESC LIMIT 1;`;

  const readRow = async (): Promise<CodebaseBindingResult | undefined> => {
    const raw = await execArchonSqlite(pi, query);
    const parts = (raw || "").split("|");
    if (!parts[0]) return undefined;
    return { id: parts[0], name: parts[1] || "", assistant: parts[2] || "claude", created: false, updated: false };
  };

  let row = await readRow();
  if (!row) {
    const projName = basename(projectCwd) || "project";
    await execArchonSqlite(pi, `INSERT INTO remote_agent_codebases (name, default_cwd, ai_assistant_type) VALUES (${sqlQuote(projName)}, ${sqlQuote(projectCwd)}, ${sqlQuote(assistant)});`);
    row = await readRow() ?? (() => { throw new Error("DB write succeeded but read failed"); })();
    return { ...row, created: true, updated: false };
  }
  if (row.assistant !== assistant) {
    await execArchonSqlite(pi, `UPDATE remote_agent_codebases SET ai_assistant_type = ${sqlQuote(assistant)}, updated_at = datetime('now') WHERE id = ${sqlQuote(row.id)};`);
    return { ...row, assistant, updated: true };
  }
  return row;
}
