import type { LogLevelConfig } from "./types";

export const ARCHON_ROOT = process.env.ARCHON_ROOT?.trim() || "/opt/archon";
export const ARCHON_DEFAULT_HOME = `${process.env.HOME || process.cwd()}/.archon`;
export const STATUS_KEY_RUNNING = "archon_running";
export const EXEC_TIMEOUT_MS = 15 * 60 * 1000;
export const PROGRESS_UPDATE_MS = 1200;
export const DEFAULT_QUERY = "decompile the next function";
export const WORKFLOWS = ["plan", "implement", "validate", "piv"] as const;

export const SKIP_KEYS = new Set(["level", "time", "pid", "hostname", "module", "msg", "err", "stack"]);
export const STEP_PATTERNS = {
  started: /^\[([^\]]+)\]\s+Started/i,
  completed: /^\[([^\]]+)\]\s+Completed/i,
  dispatching: /^Dispatching workflow:\s+\*\*(.+?)\*\*/i,
  startingWorkflow: /^🚀\s+\*\*Starting workflow\*\*/i,
  workflowCompleted: /^Workflow completed successfully\./i,
  workflowPaused: /^Workflow paused/i,
} as const;
export const JSON_STEP_MAP: Record<string, (nodeId?: string) => string | undefined> = {
  dag_node_started: (nodeId) => nodeId ? `${nodeId} started` : undefined,
  dag_node_completed: (nodeId) => nodeId ? `${nodeId} completed` : undefined,
  dag_workflow_starting: () => "workflow starting",
  dag_workflow_finished: () => "workflow finished",
  workflow_starting: () => "workflow starting",
};
export const DEFAULT_LEVEL_CONFIG: LogLevelConfig = {
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
};

// ─── Owned-repo detection ──────────────────────────────────────────────

export const OWNED_ORG_PREFIXES = ["loopyd/"] as const;

