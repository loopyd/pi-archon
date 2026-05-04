import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { normalizeError } from "../helpers";
import type { PipelineStep } from "../types";
import { rollupLocalChanges, rollupPushSuperproject, rollupStaleRefs } from "../git-util";
import { auditAllBranchHygieneStep, pruneStaleOwnedRepoBranchesStep, surfaceFeatureCandidatesStep } from "./maintenance-branches";
import { checkSubmoduleHealthStatusStep, syncSubmodulesWithRemotesStep } from "./maintenance-submodules";

async function fetchOriginSuperproject(pi: ExtensionAPI, cwd: string): Promise<string[]> {
  const lines: string[] = [];
  try {
    const result = await pi.exec("git", ["fetch", "origin"], { cwd, timeout: 30000 });
    if ((result.code ?? 0) === 0) {
      const logResult = await pi.exec("git", ["log", "--oneline", "HEAD..origin/master"], { cwd, timeout: 10000 });
      const newCount = (logResult.stdout ?? "").trim().split(/\r?\n/).filter(Boolean).length;
      if (newCount > 0) lines.push(`${newCount} new upstream commit(s)`);
      else lines.push("up-to-date");
    }
  } catch (e) {
    lines.push(normalizeError(e));
  }
  return lines;
}

async function commitUncommittedChanges(pi: ExtensionAPI, cwd: string): Promise<string[]> {
  const lines: string[] = [];
  try {
    const result = await rollupLocalChanges(pi, cwd);
    if (result.committed > 0) lines.push(`Committed ${result.committed} file(s) — \`${result.message}\``);
    else lines.push("nothing to commit");
  } catch (e) {
    lines.push(normalizeError(e));
  }
  return lines;
}

async function pushAheadCommitsToRemote(pi: ExtensionAPI, cwd: string): Promise<string[]> {
  const lines: string[] = [];
  try {
    const result = await rollupPushSuperproject(pi, cwd);
    if (result.pushed) lines.push(`Pushed ${result.commits} ahead commit(s) to origin/master`);
    else lines.push("no commits to push");
  } catch (e) {
    lines.push(normalizeError(e));
  }
  return lines;
}

async function cleanLocalWorkspaceRefs(pi: ExtensionAPI, cwd: string): Promise<string[]> {
  const lines: string[] = [];
  try {
    const result = await rollupStaleRefs(pi, cwd);
    if (result.worktreesRemoved.length > 0) lines.push(`Pruned ${result.worktreesRemoved.length} worktree(s)`);
    if (result.localDeleted.length > 0) lines.push(`Deleted local branches: ${result.localDeleted.map((branch) => `\`${branch}\``).join(", ")}`);
    if (result.remoteDeleted > 0) lines.push(`Deleted remote refs: ${String(result.remoteDeleted)}`);
    if (result.stashesCleared > 0) lines.push(`Cleared stashes: ${result.stashesCleared}`);
    if (lines.length === 0) lines.push("clean");
  } catch (e) {
    lines.push(normalizeError(e));
  }
  return lines;
}

export function buildCleanupSteps(pi: ExtensionAPI, projectCwd: string): PipelineStep[] {
  return [
    { title: "Fetch latest superproject changes", run: () => fetchOriginSuperproject(pi, projectCwd) },
    { title: "Roll up local uncommitted changes", run: () => commitUncommittedChanges(pi, projectCwd) },
    { title: "Push ahead commits to origin/master", run: () => pushAheadCommitsToRemote(pi, projectCwd) },
    { title: "Clean stale worktrees and branches", run: () => cleanLocalWorkspaceRefs(pi, projectCwd) },
    { title: "Check submodule health & status", run: () => checkSubmoduleHealthStatusStep(pi, projectCwd) },
    { title: "Sync submodules with remote defaults", run: () => syncSubmodulesWithRemotesStep(pi, projectCwd) },
    { title: "Audit submodule branch hygiene", run: () => auditAllBranchHygieneStep(pi, projectCwd) },
    { title: "Prune stale owned-repo branches", run: () => pruneStaleOwnedRepoBranchesStep(pi, projectCwd) },
    { title: "Surface feature candidates across third-party tools", run: () => surfaceFeatureCandidatesStep(pi, projectCwd) },
  ];
}
