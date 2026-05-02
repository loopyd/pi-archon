export type BufferLine = { text: string; isErr: boolean };

// ─── Log events ──────────────────────────────────────────────────────────────

export interface LiveEventLine {
  text: string;
  isErr: boolean;
  step?: string;
}

export interface LogLevelConfig {
  debug: number;
  info: number;
  warn: number;
  error: number;
}

export interface JsonPayload extends Record<string, unknown> {
  level?: number;
  module?: string;
  msg?: string;
  nodeId?: string;
  err?: unknown;
}

export type ArchonRunResult = {
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number;
};

export type CommandArchonOutcome = {
  cancelled?: boolean;
  run?: ArchonRunResult;
  error?: string;
  durationMs?: number;
};

export type CodebaseBindingResult = {
  id: string;
  name: string;
  assistant: string;
  created: boolean;
  updated: boolean;
};

export type ArchonWebCleanupResult = {
  pidFile: string;
  matchedPids: string[];
  remainingPids: string[];
};

export type CommandWorkflowOutcome = {
  cancelled?: boolean;
  run?: ArchonRunResult;
  error?: string;
  durationMs?: number;
};

export type TuiBaseParams = {
  tui: any;
  theme: any;
  title: string;
  onAbort: () => void;
  maxLines?: number;
};

// ─── Unified TUI component types (ProgressBox = consolidated ReplyBox+ProgressBox) ──

export type {
  StepState,
  ProgressStepInfo,
  StepResult,
  StreamMessage,
  LineParserFn,
  PipelineConfig,
  PhaseRunnerConfig,
  ProgressBoxParams,
  StepModeParams,
  StreamModeParams,
} from "./ui-progress-box";

export type WorkflowName = "plan" | "implement" | "validate" | "piv";

// ─── Git helpers ────────────────────────────────────────────────────────

export interface GitExecResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  code: number;
}

export interface SubmoduleInfo {
  path: string;
  defaultBranch: string;
  localHash: string;
  remoteHash: string;
  ahead: number;
  behind: number;
}

// ─── Cleanup step orchestration ────────────────────────────────────────

export type CleanupStep = {
  title: string;
  run: () => Promise<string[]>;
};

// ─── Cleanup results ────────────────────────────────────────────────────────

export interface CleanupWorktreeEntry {
  path: string;
  branch: string;
  commit: string;
  removed: boolean;
}

export interface CleanupSubmoduleEntry {
  name: string;
  path: string;
  commit: string;
  upToDate: boolean;
  dirty: boolean;
}

// Submodule branch audit types
export interface StaleRemoteRef {
  repoPath: string;
  repoName: string;
  branch: string;
  reason: "alias" | "codex" | "behind-only";
}

export interface FeatureBranchCandidate {
  repoPath: string;
  repoName: string;
  branch: string;
  uniqueCommits: number;
  lastMessage: string;
  date: string;
}

export interface SubmoduleAuditResult {
  staleRefsFound: StaleRemoteRef[];
  featureCandidates: FeatureBranchCandidate[];
  deletedLocally: { repo: string; refs: string[] }[];
  deletedRemotely: { repo: string; refs: string[] }[];
  protectedSkipped: { repo: string; refs: string[] }[];
  fetchPruned: string[];
}

export interface CleanupResult {
  webDevStopped: boolean;
  worktreesRemoved: CleanupWorktreeEntry[];
  branchesDeleted: string[];
  submodulesChecked: CleanupSubmoduleEntry[];
  archonReset: boolean;
  archonBranch: string;
  workflowRunsCleared: number;
  localChangesCommitted: number;
  superprojectPushed: boolean;
  submodulesUpdated: number;
  remoteBranchesDeleted: number;
  stashesCleared: number;
  submoduleAudit?: SubmoduleAuditResult;
  error?: string;
}
