/** Barrel module — single entry point for external consumers. All symbols are re-exported from their canonical submodule home. */

// Types
export type { ArchonRunResult, WorkflowName, CodebaseBindingResult, CleanupWorktreeEntry, FeatureBranchCandidate, StaleRemoteRef, SubmoduleAuditResult, SubmoduleInfo } from "./types";

// UI — single consolidated component
export { ProgressBox, runPhase } from "./ui-progress-box";
export { normalizeWorkflow } from "./archon-ui";

// Execution + output formatting
export { runArchonCommand, runArchonCommandStreaming, runArchonCommandWithToolUpdates, formatArchonOutput, formatArchonToolResult } from "./archon-exec";

// Git state queries & cleanup (consolidated)
export { gitExec, parseLines, collectWorktrees, pruneWorktrees, checkSubmodules, fetchSubmodules, rollupSubmodules, auditAllSubmoduleRefs, rollupStaleRefs, rollupLocalChanges, rollupPushSuperproject, readSubmodulePaths, isOwnedRepo } from "./git-util";

// Helpers
export { createMessageEmitter, normalizeError, normalizeString, resolveArchonHome, maybeString, boolOrDefault, shellQuote, sqlQuote, contentToText, formatElapsed, hasFlag, splitArgs, levelTag } from "./helpers";

// Output filtering + sanitization
export { redactSecrets, safeCode, truncateOutputBlock, cleanOutput, LogEvent } from "./output-filter";

// Commands
export { handleWorkflowCommand, runWorkflowWithToolUpdates } from "./archon-workflow-cmd";
export { handleArchonStatusCommand } from "./archon-routes";
export { handleArchonWebCommand, stopArchonWebDev } from "./archon-web-dev";
export { handleArchonCleanupCommand, handleArchonSyncSubmodulesCommand, buildSteps } from "./archon-cleanup-pipeline";
export { registerCliRoutes, registerArchonTools } from "./archon-routes";

// Constants
export * as constants from "./constants";
