import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { normalizeError } from "../helpers";
import { auditAllSubmoduleRefs, isOwnedRepo, parseLines, readSubmodulePaths } from "../git-util";
import type { FeatureBranchCandidate, StaleRemoteRef } from "../types";

interface CleanupAuditResult {
  staleRefsFound: StaleRemoteRef[];
  featureCandidates: FeatureBranchCandidate[];
  fetchPruned: string[];
  deletedLocally: { repo: string; refs: string[] }[];
  deletedRemotely: { repo: string; refs: string[] }[];
  protectedSkipped: { repo: string; refs: string[] }[];
}

interface FeatureCandidateSummaryLine {
  repo: string;
  branch: string;
  commits: number;
  message: string;
  date: string;
}

type RepoRefGroup = { repo: string; refs: string[] };

function formatRepoRefGroups(label: string, groups: RepoRefGroup[]): string | undefined {
  const active = groups.filter((entry) => entry.refs.length > 0);
  if (active.length === 0) return undefined;
  return `${label}: ${active.map((entry) => `${entry.repo}[${entry.refs.join(",")}]`).join("; ")}`;
}

export async function auditAllBranchHygieneStep(pi: ExtensionAPI, projectCwd: string): Promise<string[]> {
  try {
    const result: CleanupAuditResult = await auditAllSubmoduleRefs(pi, projectCwd);
    const lines: string[] = [];
    if (result.fetchPruned.length > 0) lines.push(`Fetched+pruned ${result.fetchPruned.length} submodule(s)`);
    if (result.staleRefsFound.length > 0) lines.push(`${result.staleRefsFound.length} stale ref(s) found`);
    const deletedLocal = formatRepoRefGroups("Deleted locally", result.deletedLocally);
    if (deletedLocal) lines.push(deletedLocal);
    const deletedRemote = formatRepoRefGroups("Deleted remotely", result.deletedRemotely);
    if (deletedRemote) lines.push(deletedRemote);
    const protectedSkipped = formatRepoRefGroups("Protected (skipped)", result.protectedSkipped);
    if (protectedSkipped) lines.push(protectedSkipped);
    if (lines.length === 0) lines.push("clean");
    return lines;
  } catch (e) {
    return [normalizeError(e)];
  }
}

export async function pruneStaleOwnedRepoBranchesStep(pi: ExtensionAPI, projectCwd: string): Promise<string[]> {
  try {
    let pruned = 0;
    const errors: string[] = [];
    for (const path of readSubmodulePaths(projectCwd)) {
      try {
        const urlResult = await pi.exec("git", ["-C", path, "remote", "get-url", "origin"], { cwd: projectCwd, timeout: 8000 });
        if (!isOwnedRepo((urlResult.stdout ?? "").trim())) continue;
        pruned += (await auditAllSubmoduleRefs(pi, projectCwd)).staleRefsFound.length;
      } catch (e) {
        errors.push(normalizeError(e));
      }
    }
    if (errors.length > 0) return [`Errors: ${errors.join(", ")}`];
    if (pruned > 0) return [`Pruned ${pruned} stale ref(s)`];
    return ["No stale refs to clean in owned repos."];
  } catch (e) {
    return [normalizeError(e)];
  }
}

export async function surfaceFeatureCandidatesStep(pi: ExtensionAPI, projectCwd: string): Promise<string[]> {
  try {
    const lines: FeatureCandidateSummaryLine[] = [];
    for (const modPath of readSubmodulePaths(projectCwd)) {
      try {
        const listResult = await pi.exec("git", ["-C", modPath, "for-each-ref", "refs/remotes/origin/", "--format=%(refname) %(objecttype)"], { cwd: projectCwd, timeout: 15000 });
        const refs = parseLines(listResult.stdout || "").map((line) => line.split(/\s+/)).filter(([name]) => name && !name.endsWith("/HEAD") && !name.endsWith("/main") && !name.endsWith("/master"));
        for (const ref of refs) {
          const shortRef = (ref[0] ?? "").replace("refs/remotes/origin/", "");
          const logResult = await pi.exec("git", ["-C", modPath, "log", "-1", "--oneline", "--format=%h %ci %s", `refs/remotes/${shortRef}`], { cwd: projectCwd, timeout: 8000 });
          const rawMsg = (logResult.stdout ?? "").trim();
          if (!rawMsg) continue;
          const match = rawMsg.match(/^([0-9a-f]+)\s+(\S+)\s+(.+)$/);
          lines.push({ repo: modPath, branch: shortRef, commits: 1, message: match?.[3] ?? "?", date: match?.[2] ?? "?" });
        }
      } catch {}
    }
    if (lines.length === 0) return ["No notable third-party feature branches."];
    return lines.slice(-40).map((entry) => `${entry.repo}/${entry.branch}: ${entry.commits} unique — "${entry.message}" (${entry.date})`);
  } catch (e) {
    return [normalizeError(e)];
  }
}
