/** Barrel module — single entry point for external consumers. All symbols are re-exported from their canonical submodule home. */

export type { ArchonRunResult, WorkflowName, CodebaseBindingResult, CleanupWorktreeEntry, FeatureBranchCandidate, StaleRemoteRef, SubmoduleAuditResult, SubmoduleInfo, ArchonEndpointConfig } from "./types";

export { ProgressBox } from "./ui/progress-box";
export { runPhase, runPipeline } from "./ui/progress-runner";
export { RunBox } from "./ui/run-box";
export { ArchonMessagePanel } from "./ui/message-panel";
export { normalizeWorkflow } from "./archon-ui";

export { runArchonCommand, runArchonCommandStreaming, runArchonCommandWithToolUpdates, formatArchonOutput, formatArchonToolResult } from "./archon-exec";

export { gitExec, parseLines, collectWorktrees, pruneWorktrees, checkSubmodules, fetchSubmodules, rollupSubmodules, auditAllSubmoduleRefs, rollupStaleRefs, rollupLocalChanges, rollupPushSuperproject, readSubmodulePaths, isOwnedRepo } from "./git-util";

export { resolveArchonEndpointConfig, resolveArchonHome, getArchonServerUrl, getArchonWebUrl, resolveProjectArchonAssistant } from "./config";
export { createMessageEmitter, normalizeError, normalizeString, maybeString, shellQuote, sqlQuote, contentToText, formatElapsed, hasFlag, splitArgs, levelTag } from "./helpers";
export { readPidFile, readLogTail, isHttpReachable, isPidRunning } from "./runtime-util";
export { listProjectWorkflowNames, peekProjectWorkflowNames, readProjectWorkflowNamesFromDisk, refreshProjectWorkflowNames, findProjectWorkflow, clearProjectWorkflowCache } from "./workflow-discovery";

export { redactSecrets, safeCode, truncateOutputBlock, cleanOutput, LogEvent } from "./output-filter";

export { handleWorkflowCommand, runWorkflowWithToolUpdates } from "./archon-workflow-cmd";
export { handleArchonStatusCommand, handleArchonWorkflowCancelCommand } from "./handlers/manage-runtime";
export { handleArchonWebCommand, stopArchonWebDev } from "./handlers/web-runtime";
export { handleArchonServerCommand, stopArchonServer } from "./handlers/server-runtime";
export { handleArchonUpdateCommand } from "./handlers/update-runtime";
export { CleanupHandler, SyncSubmodulesHandler } from "./handlers/maintenance-command";
export { registerCliRoutes, registerArchonTools } from "./archon-routes";
export { archonRouteSchema, archonToolBlocked, blockedToolResult, handleCliFallback, handleToolCommand } from "./archon-dispatch";

export * as constants from "./constants";
