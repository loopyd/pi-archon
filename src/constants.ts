import type { ArchonEndpointConfig, LogLevelConfig } from "./types";

export const ARCHON_ROOT = process.env.ARCHON_ROOT?.trim() || "/opt/archon";
export const ARCHON_DEFAULT_HOME = `${process.env.HOME || process.cwd()}/.archon`;
export const ARCHON_ENDPOINT_CONFIG_NAMES = [".pi-archon.yaml", ".pi-archon.yml", ".pi/pi-archon.yaml", ".pi/pi-archon.yml"] as const;
export const DEFAULT_ARCHON_ENDPOINTS: ArchonEndpointConfig = {
  host: "127.0.0.1",
  serverPort: "3090",
  webPort: "5173",
};
export const STATUS_KEY_RUNNING = "archon_running";
export const EXEC_TIMEOUT_MS = 15 * 60 * 1000;
export const PROGRESS_UPDATE_MS = 1200;
export const RUNTIME_HEALTH_TIMEOUT_MS = 5000;
export const RUNTIME_START_TIMEOUT_MS = 15000;
export const RUNTIME_STOP_TIMEOUT_MS = 20000;
export const RUNTIME_START_RETRIES = 30;
export const RUNTIME_START_RETRY_DELAY_MS = 500;
export const RUNTIME_STOP_RETRY_DELAY_MS = 500;
export const RUNTIME_CLEANUP_WAIT_MS = 2000;
export const RUNTIME_FORCE_KILL_WAIT_MS = 1000;
export const RUNTIME_LOG_TAIL_LINES = 80;
export const RUNTIME_STATUS_LOG_LINES = 30;
export const RUNTIME_FAILURE_LOG_LINES = 100;
export const ARCHON_DB_PATH = `${ARCHON_ROOT}/archon.db`;
export const DEFAULT_QUERY = "decompile the next function";
export const ARCHON_TITLE = "## Archon";
export const ARCHON_STATUS_TITLE = "## Archon status";
export const ARCHON_SERVER_TITLE = "## Archon Server";
export const ARCHON_SERVER_STATUS_TITLE = "## Archon Server status";
export const ARCHON_WEB_TITLE = "## Archon WEB DEV";
export const ARCHON_WEB_STATUS_TITLE = "## Archon WEB DEV status";
export const ARCHON_PILL_DEFAULT = "ARCHON";
export const ARCHON_PILL_MANAGE = "MANAGE";
export const ARCHON_PILL_SERVER = "SERVER";
export const ARCHON_PILL_WEB = "WEB";
export const ARCHON_PILL_UPDATE = "UPDATE";
export const PANEL_SIDE_PAD = 2;
export const PANEL_GUTTER = "  ";

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

export const ARCHON_THEME_RGB = {
  bg: [10, 12, 18],
  panel: [20, 24, 34],
  border: [82, 109, 196],
  accent: [6, 206, 147],
  accentHot: [146, 108, 214],
  text: [188, 231, 219],
  muted: [123, 170, 176],
  dim: [79, 109, 121],
  success: [6, 206, 147],
  warning: [180, 112, 214],
} as const;

