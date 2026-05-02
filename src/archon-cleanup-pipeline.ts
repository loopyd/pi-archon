import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import type { CleanupSubmoduleEntry, FeatureBranchCandidate, StaleRemoteRef, SubmoduleInfo } from "./types";
import { boolOrDefault, createMessageEmitter, formatElapsed, normalizeError } from "./helpers";
import { ProgressBox } from "./ui-progress-box";
import type { StepResult } from "./ui-progress-box";
import { rollupLocalChanges, rollupPushSuperproject, rollupStaleRefs, checkSubmodules, rollupSubmodules, auditAllSubmoduleRefs, readSubmodulePaths, isOwnedRepo, parseLines } from "./git-util";

const emitCleanup = createMessageEmitter("archon");

// ─── Pipeline orchestrator via ProgressBox.run() ──────────────

export async function handleArchonCleanupCommand(
  pi: ExtensionAPI,
  args: string[],
  ctx: ExtensionCommandContext
): Promise<void> {
  const projectRoot = ctx.cwd || process.cwd();
  const verboseFlag = args.some((a) => a === "--verbose" || a === "-v");
  const dryRun = args.includes("--dry-run");

  void ProgressBox.run(pi, ctx, {
    title: "cleanup",
    steps: () => buildSteps(pi, projectRoot, verboseFlag, dryRun),
    maxLines: 8,
    renderReport: (results, dur) => renderCleanupReport(results, dur),
    emitLine: (text) => emitCleanup(pi, text),
    successLabel: "Archon cleanup complete.",
    errorLabel: "Archon cleanup finished with errors.",
  });
}

function renderCleanupReport(steps: StepResult[], totalDuration: number): string {
  let md = `## Archon Workspace Cleanup Report\n\n`;
  md += `- **Duration:** \`${formatElapsed(Math.floor(totalDuration / 1000))}\`\n`;
  md += `- **Total sections:** ${steps.length}\n`;
  md += `\n---\n\n`;

  for (const s of steps) {
    md += `### ${s.title}\n\n`;
    md += `${s.lines.map((l) => `- ${l}`).join("\n")}`;
    md += `\n- **Section time:** \`${formatElapsed(Math.floor(s.durationMs / 1000))}\`\n`;
    md += "\n---\n\n";
  }
  return md;
}

// ─── Steps definition ──────────────

export function buildSteps(
  pi: ExtensionAPI,
  projectCwd: string,
  _verboseFlag?: boolean,
  dryRun?: boolean
): Array<{ title: string; run: () => Promise<string[]> }> {
  const verbose = boolOrDefault(_verboseFlag, false);
  return [
    makeStep("Fetch latest superproject changes", async () => fetchOriginSuperproject(pi, projectCwd)),
    makeStep("Roll up local uncommitted changes", async () => commitUncommittedChanges(pi, projectCwd)),
    makeStep("Push ahead commits to origin/master", async () => pushAheadCommitsToRemote(pi, projectCwd)),
    makeStep("Clean stale worktrees and branches", async () => cleanLocalWorkspaceRefs(pi, projectCwd)),
    makeStep("Check submodule health & status", async () => checkSubmoduleHealthStatus(pi, projectCwd)),
    makeStep("Sync submodules with remote defaults", async () => syncSubmodulesWithRemotesStep(pi, projectCwd)),
    makeStep("Audit submodule branch hygiene", async () => auditAllBranchHygieneStep(pi, projectCwd)),
    makeStep("Prune stale owned-repo branches", async () => pruneStaleOwnedRepoBranchesStep(pi, projectCwd)),
    makeStep("Surface feature candidates across third-party tools", async () => surfaceFeatureCandidatesStep(pi, projectCwd)),
  ];
}

function makeStep(title: string, fn: () => Promise<string[]>) { return { title, run: fn }; }

// ─── Individual step implementations ──────────────

async function fetchOriginSuperproject(pi: ExtensionAPI, cwd: string): Promise<string[]> {
  const lines: string[] = [];
  try {
    const result = await pi.exec("git", ["fetch", "origin"], { cwd, timeout: 30000 });
    if ((result.code ?? 0) === 0) {
      const logResult = await pi.exec("git", ["log", "--oneline", "HEAD..origin/master"], { cwd, timeout: 10000 });
      const newCount = (logResult.stdout ?? "").trim().split(/\r?\n/).filter(Boolean).length;
      if (newCount > 0) lines.push(`${newCount} new upstream commit(s)`);
      else lines.push(`up-to-date`);
    }
  } catch (e) { lines.push(normalizeError(e)); }
  return lines;
}

async function commitUncommittedChanges(pi: ExtensionAPI, cwd: string): Promise<string[]> {
  const lines: string[] = [];
  try {
    const result = await rollupLocalChanges(pi, cwd);
    if (result.committed > 0) lines.push(`Committed ${result.committed} file(s) — \`${result.message}\``);
    else lines.push(`nothing to commit`);
  } catch (e) { lines.push(normalizeError(e)); }
  return lines;
}

async function pushAheadCommitsToRemote(pi: ExtensionAPI, cwd: string): Promise<string[]> {
  const lines: string[] = [];
  try {
    const result = await rollupPushSuperproject(pi, cwd);
    if (result.pushed) lines.push(`Pushed ${result.commits} ahead commit(s) to origin/master`);
    else lines.push(`no commits to push`);
  } catch (e) { lines.push(normalizeError(e)); }
  return lines;
}

async function cleanLocalWorkspaceRefs(pi: ExtensionAPI, cwd: string): Promise<string[]> {
  const lines: string[] = [];
  try {
    const result = await rollupStaleRefs(pi, cwd);
    if (result.worktreesRemoved.length > 0) lines.push(`Pruned ${result.worktreesRemoved.length} worktree(s)`);
    if (result.localDeleted.length > 0) lines.push("Deleted local branches: " + result.localDeleted.map((b) => "`" + b + "`").join(", "));
    if (result.remoteDeleted > 0) lines.push("Deleted remote refs: " + String(result.remoteDeleted));
    if (result.stashesCleared > 0) lines.push(`Cleared stashes: ${result.stashesCleared}`);
    if (lines.length === 0) lines.push(`clean`);
  } catch (e) { lines.push(normalizeError(e)); }
  return lines;
}

// ─── Submodule health check ──────────────

interface CleanupSubmoduleEntryExtended extends CleanupSubmoduleEntry { name: string; path: string; commit: string; upToDate: boolean; dirty: boolean; }

async function checkSubmoduleHealthStatus(
  pi: ExtensionAPI,
  projectCwd: string
): Promise<string[]> {
  const entries: CleanupSubmoduleEntryExtended[] = await checkSubmodules(pi, projectCwd);
  const out: string[] = [];

  for (const entry of entries) {
    let status = "";
    if (!entry.upToDate && !entry.dirty) status = "⬇️ behind";
    else if (entry.dirty) status = "🏷️ modified";
    else status = "✅ up-to-date";
    out.push(`${entry.name}: ${status} (${entry.commit})`);
  }
  return out;
}

// ─── Sync submodules with remotes (delegates to git-util rollup) ──────────────

export async function syncSubmodulesWithRemotes(
  pi: ExtensionAPI,
  projectCwd: string
): Promise<{ updated: SubmoduleInfo[]; pushed: string[]; errors: string[] }> {
  return rollupSubmodules(pi, projectCwd);
}

async function formatSyncSummary(updated: SubmoduleInfo[], pushed: string[], errors: string[]): Promise<string[]> {
  const out: string[] = [];
  if (errors.length > 0) out.push(`Errors: ${errors.join(", ")}`);
  if (updated.length > 0) out.push(`Updated ${updated.length} behind submodule(s)`);
  if (pushed.length > 0) out.push(`Pushed ahead to origin in ${pushed.map((p) => `\`${p}\``).join(", ")}`);
  if (out.length === 0) out.push(`All submodules aligned with remotes.`);
  return out;
}

export async function syncSubmodulesWithRemotesStep(pi: ExtensionAPI, projectCwd: string): Promise<string[]> {
  try {
    const result = await syncSubmodulesWithRemotes(pi, projectCwd);
    return formatSyncSummary(result.updated, result.pushed, result.errors);
  } catch (e) { return [normalizeError(e)]; }
}

// ─── Audit all branch hygiene ──────────────

interface CleanupAuditResult { staleRefsFound: StaleRemoteRef[]; featureCandidates: FeatureBranchCandidate[]; fetchPruned: string[]; deletedLocally: { repo: string; refs: string[] }[]; deletedRemotely: { repo: string; refs: string[] }[]; protectedSkipped: { repo: string; refs: string[] }[]; }

async function auditAllBranchHygiene(
  pi: ExtensionAPI,
  projectCwd: string
): Promise<CleanupAuditResult> {
  return auditAllSubmoduleRefs(pi, projectCwd);
}

export async function auditAllBranchHygieneStep(pi: ExtensionAPI, projectCwd: string): Promise<string[]> {
  try {
    const result = await auditAllBranchHygiene(pi, projectCwd);
    const out: string[] = [];
    if (result.fetchPruned.length > 0) out.push(`Fetched+pruned ${result.fetchPruned.length} submodule(s)`);
    if (result.staleRefsFound.length > 0) out.push(`${result.staleRefsFound.length} stale ref(s) found`);
    if (result.deletedLocally.some((d) => d.refs.length)) out.push(`Deleted locally: ${result.deletedLocally.filter((d) => d.refs.length).map((d) => `${d.repo}[${d.refs.join(",")}]`).join("; ")}`);
    if (result.deletedRemotely.some((d) => d.refs.length)) out.push(`Deleted remotely: ${result.deletedRemotely.filter((d) => d.refs.length).map((d) => `${d.repo}[${d.refs.join(",")}]`).join("; ")}`);
    if (result.protectedSkipped.some((p) => p.refs.length)) out.push(`Protected (skipped): ${result.protectedSkipped.filter((p) => p.refs.length).map((p) => `${p.repo}[${p.refs.join(",")}]`).join("; ")}`);
    if (out.length === 0) out.push(`clean`);
    return out;
  } catch (e) { return [normalizeError(e)]; }
}

// ─── Prune stale owned-repo branches ──────────────

async function pruneStaleOwnedRepoBranches(
  pi: ExtensionAPI,
  projectCwd: string
): Promise<{ pruned: number; errors: string[] }> {
  let totalPruned = 0;
  const errors: string[] = [];
  const paths = readSubmodulePaths(projectCwd);

  for (const path of paths) {
    try {
      const urlResult = await pi.exec("git", ["-C", path, "remote", "get-url", "origin"], { cwd: projectCwd, timeout: 8000 });
      const url = (urlResult.stdout ?? "").trim();
      if (!isOwnedRepo(url)) continue;

      // Use git-util's consolidated auditor which handles gh API deletion + local prune
      const fullResult = await auditAllSubmoduleRefs(pi, projectCwd);
      totalPruned += fullResult.staleRefsFound.length; // all are deletable (alias/codex/behind-only)
    } catch (e) { errors.push(normalizeError(e)); }
  }

  return { pruned: totalPruned, errors };
}

export async function pruneStaleOwnedRepoBranchesStep(pi: ExtensionAPI, projectCwd: string): Promise<string[]> {
  try {
    const result = await pruneStaleOwnedRepoBranches(pi, projectCwd);
    if (result.errors.length > 0) return [`Errors: ${result.errors.join(", ")}`];
    if (result.pruned > 0) return [`Pruned ${result.pruned} stale ref(s)`];
    return [`No stale refs to clean in owned repos.`];
  } catch (e) { return [normalizeError(e)]; }
}

// ─── Surface feature candidates across third-party tools ──────────────

interface FeatureCandidateSummaryLine { repo: string; branch: string; commits: number; message: string; date: string; }

async function surfaceFeatureCandidatesThirdParty(
  pi: ExtensionAPI,
  projectCwd: string
): Promise<FeatureCandidateSummaryLine[]> {
  const paths = readSubmodulePaths(projectCwd);
  const features: FeatureCandidateSummaryLine[] = [];

  for (const modPath of paths) {
    try {
      const listResult = await pi.exec("git", ["-C", modPath, "for-each-ref", "refs/remotes/origin/", "--format=%(refname) %(objecttype)"], { cwd: projectCwd, timeout: 15000 });
      const lines = parseLines(listResult.stdout || "");
      const refParts = lines.map((line) => line.split(/\s+/)).filter(([name]) => name && !name.endsWith("/HEAD") && !name.endsWith("/main") && !name.endsWith("/master"));

      for (const [, _type] of refParts) {
        const shortRef = (refParts[0]?.[0] ?? "").replace("refs/remotes/origin/", "");
        const logResult = await pi.exec("git", ["-C", modPath, "log", "-1", "--oneline", "--format=%h %ci %s", `refs/remotes/${shortRef}`], { cwd: projectCwd, timeout: 8000 });
        const rawMsg = (logResult.stdout ?? "").trim();
        if (!rawMsg) continue;
        const commitMatch = rawMsg.match(/^([0-9a-f]+)\s+(\S+)\s+(.+)$/);
        features.push({ repo: modPath, branch: shortRef, commits: 1, message: commitMatch?.[3] ?? "?", date: commitMatch?.[2] ?? "?" });
      }
    } catch { /* best effort */ }
  }

  return features.slice(-40);
}

export async function surfaceFeatureCandidatesStep(pi: ExtensionAPI, projectCwd: string): Promise<string[]> {
  try {
    const candidates = await surfaceFeatureCandidatesThirdParty(pi, projectCwd);
    if (candidates.length === 0) return [`No notable third-party feature branches.`];
    return candidates.map((c) => `${c.repo}/${c.branch}: ${c.commits} unique — "${c.message}" (${c.date})`);
  } catch (e) { return [normalizeError(e)]; }
}

// ════════════════════════════════════════════════════════════
// Sync-submodules command
// ════════════════════════════════════════════════════════════

const emitSync = createMessageEmitter("archon");

export async function handleArchonSyncSubmodulesCommand(
  pi: ExtensionAPI,
  _args: string[],
  ctx: ExtensionCommandContext
): Promise<void> {
  const projectCwd = ctx.cwd || process.cwd();
  const submodPaths = readSubmodulePaths(projectCwd);

  void ProgressBox.run(pi, ctx, {
    title: "sync-submodules",
    steps: () => [
      ...submodPaths.map((p) => ({
        title: `fetch ${p}`,
        run: () => syncOneSubmodule(pi, p, projectCwd),
      })),
      {
        title: "commit pointer updates",
        run: () => syncCommitPointerChangesSelfContained(pi, projectCwd),
      },
    ],
    maxLines: Math.min(submodPaths.length + 3, 10),
    renderReport: (results, dur) => {
      const updated = countOutcome(results, "→ synced");
      const pushed = countOutcome(results, "→ pushed");
      const errs = results.filter((r) => !r.ok).length;
      const lines: string[] = [];
      if (errs > 0) lines.push(`${errs} submodule(s) had errors`);
      if (updated > 0) lines.push(`Updated ${updated} behind submodule(s)`);
      if (pushed > 0) lines.push(`Pushed ahead in ${pushed} submodule(s)`);
      if (lines.length === 0) lines.push("All submodules aligned with remotes.");
      return `## Submodule sync\n\n${lines.join("\n")}\n\n- **Duration:** \`${formatElapsed(Math.floor(dur / 1000))}\`\n`;
    },
    emitLine: (text) => emitSync(pi, text),
    successLabel: "Submodule sync complete.",
    errorLabel: "Submodule sync finished with errors.",
  });
}

function countOutcome(results: StepResult[], marker: string): number {
  return results.reduce((sum, r) => sum + r.lines.filter((l) => l.includes(marker)).length, 0);
}

/** Sync a single submodule — returns summary lines */
async function syncOneSubmodule(
  pi: ExtensionAPI,
  modPath: string,
  projectCwd: string
): Promise<string[]> {
  try {
    const fetchResult = await pi.exec("git", ["-C", modPath, "fetch", "--quiet", "origin"], { cwd: projectCwd, timeout: 15000 });
    if ((fetchResult.code ?? 0) !== 0) return [`fetch failed`] as string[];

    let defaultBranch = "master";
    const headRef = await pi.exec("git", ["-C", modPath, "symbolic-ref", "refs/remotes/origin/HEAD"], { cwd: projectCwd, timeout: 10000 });
    if ((headRef.code ?? 0) === 0) {
      const refMatch = (headRef.stdout ?? "").match(/refs\/remotes\/origin\/(.+)/);
      if (refMatch?.[1]) defaultBranch = refMatch[1];
    }

    const localHash = (await pi.exec("git", ["-C", modPath, "rev-parse", "HEAD"], { cwd: projectCwd, timeout: 10000 })).stdout?.trim();
    const remoteHash = (await pi.exec("git", ["-C", modPath, "rev-parse", `origin/${defaultBranch}`], { cwd: projectCwd, timeout: 10000 })).stdout?.trim();

    // Behind → checkout
    if (localHash && remoteHash && localHash !== remoteHash) {
      const behindLog = (await pi.exec("git", ["-C", modPath, "log", "--oneline", `${localHash}..${remoteHash}`], { cwd: projectCwd, timeout: 10000 })).stdout?.trim();
      const behindCount = behindLog ? behindLog.split(/\r?\n/).filter(Boolean).length : 0;
      if (behindCount > 0) {
        const checkout = await pi.exec("git", ["-C", modPath, "checkout", `origin/${defaultBranch}`, "--quiet"], { cwd: projectCwd, timeout: 10000 });
        if ((checkout.code ?? 0) === 0) return [`${behindCount} commit(s) behind → synced`];
      }
    }

    // Ahead → push
    if (localHash && remoteHash) {
      const aheadLog = (await pi.exec("git", ["-C", modPath, "log", "--oneline", `${remoteHash}..${localHash}`], { cwd: projectCwd, timeout: 10000 })).stdout?.trim();
      const aheadCount = aheadLog ? aheadLog.split(/\r?\n/).filter(Boolean).length : 0;
      if (aheadCount > 0) {
        const push = await pi.exec("git", ["-C", modPath, "push", "origin", defaultBranch], { cwd: projectCwd, timeout: 30000 });
        if ((push.code ?? 0) === 0) return [`${aheadCount} commit(s) ahead → pushed`];
        else return [`push failed (${(push.stderr ?? "").slice(0, 80)})`];
      }
    }

    return ["aligned"];
  } catch (e) {
    return [`error: ${normalizeError(e)}`];
  }
}

/** Self-contained: check git diff for submodule pointer changes and commit them */
async function syncCommitPointerChangesSelfContained(
  pi: ExtensionAPI,
  projectCwd: string
): Promise<string[]> {
  try {
    const diff = await pi.exec("git", ["diff", "--name-only"], { cwd: projectCwd, timeout: 10000 });
    const changed = parseLines(diff.stdout || "");
    if (changed.length === 0) return ["no pointer changes detected"];
    await pi.exec("git", ["add", ...changed], { cwd: projectCwd, timeout: 10000 });
    await pi.exec("git", ["commit", "-m", `chore(submodules): update ${changed.length} submodule(s)`], { cwd: projectCwd, timeout: 15000 });
    return [`committed pointer updates for ${changed.length} submodule(s)`];
  } catch (e) {
    return [`pointer commit: ${normalizeError(e)}`];
  }
}
