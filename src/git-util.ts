import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import * as fs from "node:fs";
import { basename } from "node:path";
import type { CleanupSubmoduleEntry, CleanupWorktreeEntry, FeatureBranchCandidate, GitExecResult, StaleRemoteRef, SubmoduleAuditResult, SubmoduleInfo } from "./types";
import { OWNED_ORG_PREFIXES } from "./constants";
import { resolveArchonHome } from "./config";
import { shellQuote } from "./helpers";
import { isPidRunning } from "./runtime-util";

// ─── Safe git execution wrapper ─────────────────────────────

export async function gitExec(
  pi: ExtensionAPI,
  args: string[],
  projectCwd: string,
  timeout = 15000
): Promise<GitExecResult> {
  try {
    const result = await pi.exec("git", args, { cwd: projectCwd, timeout });
    const code = result.code ?? 0;
    return { ok: code === 0, stdout: result.stdout ?? "", stderr: result.stderr ?? "", code };
  } catch {
    return { ok: false, stdout: "", stderr: "exception", code: -1 };
  }
}

// ─── Line parsing utility ─────────────────────────────

export function parseLines(stdout: string): string[] {
  return stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}

// ─── Owned-repo detection ──────────────────────────────

export function isOwnedRepo(url: string): boolean {
  return OWNED_ORG_PREFIXES.some((prefix) => url.includes(prefix));
}

// ─── Worktree collection & pruning ──────────────────────

/** Enumerate worktrees via porcelain output */
export async function collectWorktrees(pi: ExtensionAPI, projectCwd: string): Promise<CleanupWorktreeEntry[]> {
  const result = await pi.exec("git", ["worktree", "list", "--porcelain"], { cwd: projectCwd, timeout: 15000 });
  const entries: CleanupWorktreeEntry[] = [];
  const lines = (result.stdout ?? "").split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const pathMatch = lines[i]?.match(/^worktree\s+(.+)$/);
    if (!pathMatch) continue;
    let branch = "";
    let commit = "";
    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j] ?? "";
      if (/^worktree\s+/.test(line)) break;
      const brMatch = line.match(/^branch\s+(.+)$/);
      if (brMatch) branch = brMatch[1].trim();
      const headMatch = line.match(/^HEAD\s+(.+)$/);
      if (headMatch) commit = headMatch[1].trim();
    }
    entries.push({ path: pathMatch[1].trim(), branch, commit, removed: false });
  }
  return entries;
}

/** Remove non-main worktrees and their associated branches */
export async function pruneWorktrees(
  pi: ExtensionAPI,
  projectCwd: string,
  worktrees: CleanupWorktreeEntry[]
): Promise<{ removed: CleanupWorktreeEntry[]; branchesDeleted: string[] }> {
  const removed: CleanupWorktreeEntry[] = [];
  const branchesDeleted: string[] = [];
  const toRemove = worktrees.filter((wt) => !wt.path.endsWith(projectCwd));

  for (const wt of toRemove) {
    try {
      const rmResult = await pi.exec("git", ["worktree", "remove", "--force", wt.path], { cwd: projectCwd, timeout: 10000 });
      if ((rmResult.code ?? 0) === 0 || true) { // catch also counts as already-gone
        wt.removed = true;
        removed.push(wt);
      }
    } catch {
      wt.removed = true;
      removed.push(wt);
    }
  }

  for (const wt of removed) {
    if (!wt.branch) continue;
    try {
      await pi.exec("git", ["branch", "-D", wt.branch], { cwd: projectCwd, timeout: 10000 });
      branchesDeleted.push(wt.branch);
    } catch { /* already deleted */ }
  }

  return { removed, branchesDeleted };
}

// ─── Submodule helpers ──────────────────────────────

/** Extract submodule paths from .gitmodules */
export function readSubmodulePaths(projectCwd: string): string[] {
  const gitmodulesPath = `${projectCwd}/.gitmodules`;
  if (!fs.existsSync(gitmodulesPath)) return [];
  const raw = fs.readFileSync(gitmodulesPath, "utf8");
  return raw.split(/\r?\n/)
    .filter((l) => l.includes("path "))
    .map((l) => l.split("=")[1]?.trim())
    .filter(Boolean);
}

/** Resolve a submodule's default tracking branch from .gitmodules config */
function resolveSubmoduleDefaultBranch(submodulePath: string): string | undefined {
  const configPath = `${submodulePath}/../../.gitmodules`;
  if (!fs.existsSync(configPath)) return undefined;
  const lines = fs.readFileSync(configPath, "utf8").split(/\r?\n/);
  let currentName = "";
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i]?.match(/^\[submodule\s+"([^"]+)"\]/);
    if (m) currentName = m[1];
    else if (currentName && lines[i]?.trim() === `path = ${submodulePath}`) {
      for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
        const bm = lines[j]?.match(/^branch\s*=\s*(.+)$/);
        if (bm) return bm[1].trim();
        if (/^\w/.test(lines[j]?.trim()) && !lines[j]?.trim().startsWith("#")) break;
      }
    }
  }
  return undefined;
}

/** Check each submodule's up-to-date and dirty status */
export async function checkSubmodules(
  pi: ExtensionAPI,
  projectCwd: string
): Promise<CleanupSubmoduleEntry[]> {
  const listResult = await pi.exec("git", ["submodule", "status", "--"], { cwd: projectCwd, timeout: 15000 });
  const entries: CleanupSubmoduleEntry[] = [];
  const lines = (listResult.stdout ?? "").split(/\r?\n/).filter((line) => line.trim());

  for (const line of lines) {
    const match = line.match(/^([\+\-\?]?)([0-9a-f]{40})\s+(.+)$/);
    if (!match) continue;
    const [, , fullCommit, name] = match;
    const shortCommit = fullCommit.slice(0, 12);

    const checkResult = await pi.exec("bash", [
      "-lc", [
        `cd ${shellQuote(projectCwd)}/${shellQuote(name)}`,
        'headCommit=$(git rev-parse remotes/origin/HEAD 2>/dev/null || git rev-parse origin/main 2>/dev/null || git rev-parse origin/master 2>/dev/null || echo "unknown")',
        'upToDate="false"',
        'if [ "' + shortCommit + '" = "$headCommit" ]; then upToDate="true"; fi',
        'dirty="false"',
        'if [ -n "$(git status --porcelain 2>/dev/null)" ]; then dirty="true"; fi',
        'echo "${upToDate}|${dirty}"',
      ].join(" && "),
    ], { cwd: projectCwd, timeout: 10000 });

    const parts = (checkResult.stdout ?? "").trim().split("|");
    entries.push({ name, path: name, commit: shortCommit, upToDate: parts[0] === "true", dirty: parts[1] === "true" });
  }
  return entries;
}

// ─── Submodule fetch + ahead/behind analysis ──────────────

async function fetchSubmodules(pi: ExtensionAPI, projectCwd: string): Promise<SubmoduleInfo[]> {
  const modPaths = readSubmodulePaths(projectCwd);
  const infos: SubmoduleInfo[] = [];

  for (const modPath of modPaths) {
    try {
      const fetchResult = await gitExec(pi, ["-C", modPath, "fetch", "--quiet", "origin"], projectCwd, 15000);
      if (!fetchResult.ok) continue;

      let defaultBranch = "master";
      const headRef = await gitExec(pi, ["-C", modPath, "symbolic-ref", "refs/remotes/origin/HEAD"], projectCwd, 10000);
      if (headRef.ok) {
        const refMatch = headRef.stdout.match(/refs\/remotes\/origin\/(.+)/);
        if (refMatch?.[1]) defaultBranch = refMatch[1];
      }

      const localResult = await gitExec(pi, ["-C", modPath, "rev-parse", "HEAD"], projectCwd, 10000);
      const remoteResult = await gitExec(pi, ["-C", modPath, "rev-parse", `origin/${defaultBranch}`], projectCwd, 10000);
      if (!localResult.ok || !remoteResult.ok) continue;

      const localHash = localResult.stdout.trim();
      const remoteHash = remoteResult.stdout.trim();
      let ahead = 0, behind = 0;

      if (localHash !== remoteHash) {
        const aheadLog = await gitExec(pi, ["-C", modPath, "log", "--oneline", `${remoteHash}..${localHash}`], projectCwd, 10000);
        ahead = parseLines(aheadLog.stdout).length;
        const behindLog = await gitExec(pi, ["-C", modPath, "log", "--oneline", `${localHash}..${remoteHash}`], projectCwd, 10000);
        behind = parseLines(behindLog.stdout).length;
      }

      infos.push({ path: modPath, defaultBranch, localHash, remoteHash, ahead, behind });
    } catch { /* skip failing submodules */ }
  }
  return infos;
}

/** Fetch each submodule + compute ahead/behind counts (internal data gatherer) */
export {
  fetchSubmodules,
};

/** Fetch all submodules then update those behind and push those ahead */
export async function rollupSubmodules(
  pi: ExtensionAPI,
  projectCwd: string
): Promise<{ updated: SubmoduleInfo[]; pushed: string[]; errors: string[] }> {
  const infos = await fetchSubmodules(pi, projectCwd);
  const updated: SubmoduleInfo[] = [];
  const pushed: string[] = [];
  const errors: string[] = [];

  for (const info of infos) {
    try {
      if (info.behind > 0) {
        const checkout = await gitExec(pi, ["-C", info.path, "checkout", `origin/${info.defaultBranch}`, "--quiet"], projectCwd, 10000);
        if (checkout.ok) updated.push(info);
        else errors.push(`${info.path}: checkout failed`);
      }
      if (info.ahead > 0) {
        const push = await gitExec(pi, ["-C", info.path, "push", "origin", info.defaultBranch], projectCwd, 30000);
        if (push.ok) pushed.push(info.path);
        else errors.push(`${info.path}: push failed (${push.stderr.slice(0, 80)})`);
      }
    } catch { errors.push(info.path); }
  }

  // Commit submodule pointer changes
  if (updated.length > 0) {
    const diff = await gitExec(pi, ["diff", "--name-only"], projectCwd, 10000);
    const changed = parseLines(diff.stdout);
    if (changed.length > 0) {
      await gitExec(pi, ["add", ...changed], projectCwd, 10000);
      await gitExec(pi, ["commit", "-m", `chore(submodules): update ${updated.length} submodules`], projectCwd, 15000);
    }
  }

  return { updated, pushed, errors };
}

// ─── Submodule branch auditing ──────────────────────

async function auditOneSubmoduleRemoteRefs(
  pi: ExtensionAPI,
  projectCwd: string,
  submodulePath: string,
  modName: string
): Promise<{ stale: StaleRemoteRef[]; features: FeatureBranchCandidate[] }> {
  const stale: StaleRemoteRef[] = [];
  const features: FeatureBranchCandidate[] = [];

  try {
    const defBranch = resolveSubmoduleDefaultBranch(submodulePath) || "HEAD";
    const defResult = await gitExec(pi, ["-C", submodulePath, "rev-parse", `refs/remotes/origin/${defBranch}`], projectCwd, 10000);
    if (!defResult.ok) return { stale, features };
    const defHash = defResult.stdout.trim().slice(0, 40);

    const listResult = await gitExec(pi, ["-C", submodulePath, "for-each-ref", "refs/remotes/origin/", "--format=%(refname)"], projectCwd, 10000);
    if (!listResult.ok) return { stale, features };

    for (const fullRef of parseLines(listResult.stdout).filter((r) => !r.endsWith("/HEAD"))) {
      const shortRef = fullRef.replace("refs/remotes/origin/", "");
      if (shortRef === defBranch) continue;

      const hashResult = await gitExec(pi, ["-C", submodulePath, "rev-parse", fullRef], projectCwd, 8000);
      if (!hashResult.ok) continue;
      const branchHash = hashResult.stdout.trim().slice(0, 40);

      const aheadResult = await gitExec(pi, ["-C", submodulePath, "log", "--oneline", `${defHash}..${branchHash}`], projectCwd, 8000);
      const aheadCount = parseLines(aheadResult.stdout).length;

      if (aheadCount === 0) {
        let reason: StaleRemoteRef["reason"] = "behind-only";
        if (branchHash === defHash) reason = "alias";
        else if (/^codex\//i.test(shortRef)) reason = "codex";
        stale.push({ repoPath: submodulePath, repoName: modName, branch: shortRef, reason });
      } else if (/^codex\/all-/i.test(shortRef) && aheadCount <= 2) {
        stale.push({ repoPath: submodulePath, repoName: modName, branch: shortRef, reason: "codex" });
      } else {
        const msgResult = await gitExec(pi, ["-C", submodulePath, "log", "-1", "--format=%s", `refs/remotes/${fullRef.replace("refs/remotes/", "")}`], projectCwd, 5000);
        const dateResult = await gitExec(pi, ["-C", submodulePath, "log", "-1", "--format=%ci", `refs/remotes/${fullRef.replace("refs/remotes/", "")}`], projectCwd, 5000);
        features.push({
          repoPath: submodulePath, repoName: modName, branch: shortRef, uniqueCommits: aheadCount,
          lastMessage: msgResult.ok ? msgResult.stdout.trim() : "?",
          date: dateResult.ok ? dateResult.stdout.trim().slice(0, 10) : "?",
        });
      }
    }
  } catch { /* best-effort */ }

  return { stale, features };
}

/** Fetch+prune every submodule, audit remote refs, delete stale ones via gh API or local prune */
export async function auditAllSubmoduleRefs(
  pi: ExtensionAPI,
  projectCwd: string
): Promise<SubmoduleAuditResult> {

  const allStale: StaleRemoteRef[] = [];
  const allFeatures: FeatureBranchCandidate[] = [];
  const fetchedPaths: string[] = [];
  const paths = readSubmodulePaths(projectCwd);

  // Phase 1: fetch + prune
  for (const subPath of paths) {
    try {
      const result = await gitExec(pi, ["-C", subPath, "fetch", "origin", "--prune"], projectCwd, 30000);
      if (result.ok || result.code === 0) fetchedPaths.push(subPath);
    } catch { /* best effort */ }
  }

  // Phase 2: audit each submodule
  for (const subPath of paths) {
    const { stale, features } = await auditOneSubmoduleRemoteRefs(pi, projectCwd, subPath, basename(subPath));
    allStale.push(...stale);
    allFeatures.push(...features);
  }

  // Phase 3: clean up stale refs
  const byRepo = new Map<string, StaleRemoteRef[]>();
  for (const ref of allStale) {
    const existing = byRepo.get(ref.repoPath);
    if (!existing) byRepo.set(ref.repoPath, [ref]);
    else existing.push(ref);
  }

  const deletedLocallyMap = new Map<string, string[]>();
  const deletedRemotelyMap = new Map<string, string[]>();
  const protectedSkippedMap = new Map<string, string[]>();

  for (const [repoPath, refs] of byRepo.entries()) {
    const modName = basename(repoPath);
    const localDeleted: string[] = [];
    let remoteDeleted: string[] | undefined;
    let skipped: string[] | undefined;

    // Try gh API deletion for owned repos
    const urlResult = await gitExec(pi, ["-C", repoPath, "remote", "get-url", "origin"], projectCwd, 8000);
    const url = urlResult.ok ? urlResult.stdout.trim() : "";
    if (isOwnedRepo(url)) {
      const orgMatch = url.match(/github\.com[\/\/]([^\/]+)\/([^\/]+)/);
      const orgRepo = orgMatch ? `${orgMatch[1]}/${orgMatch[2]}` : undefined;
      if (orgRepo) {
        remoteDeleted = [];
        skipped = [];
        for (const staleRef of refs) {
          const apiResult = await pi.exec("gh", ["api", `repos/${orgRepo}/git/ref/heads/${staleRef.branch}`, "--method", "DELETE"], { cwd: projectCwd, timeout: 15000 });
          const output = `${apiResult.stdout ?? ""}\n${apiResult.stderr ?? ""}`;
          if ((apiResult.code ?? 0) === 0) {
            remoteDeleted.push(staleRef.branch);
          } else if (output.includes("BranchProtectionRule") && output.includes("denied")) {
            skipped.push(staleRef.branch);
          }
        }
      }
    }

    // Local prune via fetch --prune or manual update-ref -d
    const pruneResult = await gitExec(pi, ["-C", repoPath, "fetch", "origin", "--prune"], projectCwd, 30000);
    if (!pruneResult.ok) {
      for (const staleRef of refs) {
        try {
          await gitExec(pi, ["-C", repoPath, "update-ref", "-d", `refs/remotes/origin/${staleRef.branch}`], projectCwd, 5000);
          localDeleted.push(staleRef.branch);
        } catch { /* already gone */ }
      }
    } else {
      const afterFetchList = await gitExec(pi, ["-C", repoPath, "for-each-ref", "refs/remotes/origin/", "--format=%(refname)"], projectCwd, 8000);
      const remainingRefs = new Set(parseLines(afterFetchList.stdout));
      for (const staleRef of refs) {
        if (!remainingRefs.has(`refs/remotes/origin/${staleRef.branch}`)) localDeleted.push(staleRef.branch);
      }
    }

    deletedLocallyMap.set(modName, [...new Set(localDeleted)]);
    if (remoteDeleted?.length) deletedRemotelyMap.set(modName, remoteDeleted);
    if (skipped?.length) protectedSkippedMap.set(modName, skipped);
  }

  return {
    staleRefsFound: allStale,
    featureCandidates: allFeatures,
    deletedLocally: [...deletedLocallyMap.entries()].map(([repo, refs]) => ({ repo, refs })),
    deletedRemotely: [...deletedRemotelyMap.entries()].map(([repo, refs]) => ({ repo, refs })),
    protectedSkipped: [...protectedSkippedMap.entries()].map(([repo, refs]) => ({ repo, refs })),
    fetchPruned: fetchedPaths,
  };
}

// ─── Superproject ref cleanup ──────────────────────

/** Collect + delete merged branches, prune worktrees, clear stashes — superproject scope only */
export async function rollupStaleRefs(
  pi: ExtensionAPI,
  projectCwd: string
): Promise<{ worktreesRemoved: CleanupWorktreeEntry[]; localDeleted: string[]; remoteDeleted: number; stashesCleared: number }> {
  const worktreesRemoved: CleanupWorktreeEntry[] = [];
  const localDeleted: string[] = [];
  let remoteDeleted = 0;
  let stashesCleared = 0;

  // Worktrees
  const wtResult = await gitExec(pi, ["worktree", "list", "--porcelain"], projectCwd, 15000);
  const wtLines = parseLines(wtResult.stdout);
  for (let i = 0; i < wtLines.length; i++) {
    const pathMatch = wtLines[i]?.match(/^worktree\s+(.+)$/);
    if (!pathMatch) continue;
    const wtPath = pathMatch[1].trim();
    if (wtPath.endsWith(projectCwd)) continue;
    let branch = "";
    for (let j = i + 1; j < wtLines.length; j++) {
      const line = wtLines[j] ?? "";
      if (/^worktree\s+/.test(line)) break;
      const brMatch = line.match(/^branch\s+(.+)$/);
      if (brMatch) branch = brMatch[1].trim();
    }
    try {
      const removeResult = await gitExec(pi, ["worktree", "remove", "--force", wtPath], projectCwd, 10000);
      worktreesRemoved.push({ path: wtPath, branch, commit: "", removed: removeResult.ok });
    } catch {
      worktreesRemoved.push({ path: wtPath, branch, commit: "", removed: true });
    }
  }

  // Delete branches associated with removed worktrees
  for (const wt of worktreesRemoved) {
    if (!wt.branch) continue;
    try { await gitExec(pi, ["branch", "-D", wt.branch], projectCwd, 10000); localDeleted.push(wt.branch); }
    catch { /* already deleted */ }
  }

  // Other merged local branches
  const branches = await gitExec(pi, ["branch", "--merged", "master", "--no-color"], projectCwd, 10000);
  for (const branchName of parseLines(branches.stdout).map((l) => l.replace(/^\s+\*/, "").replace(/^\*/, "").trim()).filter((name) => name && name !== "master" && !localDeleted.includes(name))) {
    try { await gitExec(pi, ["branch", "-d", branchName], projectCwd, 10000); localDeleted.push(branchName); }
    catch { /* gone */ }
  }

  // Merged remote branches (protect master/main/dependabot)
  const remoteMerged = await gitExec(pi, ["branch", "-r", "--merged", "master"], projectCwd, 10000);
  for (const refName of parseLines(remoteMerged.stdout).filter((b) => !b.includes("HEAD") && !b.includes("origin/master") && !b.includes("dependabot"))) {
    try {
      const push = await gitExec(pi, ["push", "origin", "--delete", refName.replace("origin/", "")], projectCwd, 15000);
      if (push.ok) remoteDeleted++;
    } catch { /* gone */ }
  }

  // Prune + clear stashes
  await gitExec(pi, ["remote", "prune", "origin"], projectCwd, 10000);
  const stashList = await gitExec(pi, ["stash", "list"], projectCwd, 10000);
  stashesCleared = parseLines(stashList.stdout).length;
  if (stashesCleared > 0) await gitExec(pi, ["stash", "clear"], projectCwd, 10000);

  return { worktreesRemoved, localDeleted, remoteDeleted, stashesCleared };
}

// ─── Rollup helpers ──────────────────────

/** Stage and commit any uncommitted changes in the superproject */
export async function rollupLocalChanges(pi: ExtensionAPI, projectCwd: string): Promise<{ committed: number; message: string }> {
  const status = await gitExec(pi, ["status", "--porcelain"], projectCwd, 10000);
  const files = parseLines(status.stdout).map((line) => line.slice(3).trim()).filter(Boolean);
  if (files.length === 0) return { committed: 0, message: "nothing to commit" };

  const add = await gitExec(pi, ["add", ...files], projectCwd, 10000);
  if (!add.ok) return { committed: 0, message: `failed to stage ${files.length} file(s)` };

  const dirs = [...new Set(files.map((f) => f.split("/")[0] || "."))].join(", ");
  const msg = `chore: roll up local changes (${dirs})`;
  const commit = await gitExec(pi, ["commit", "-m", msg], projectCwd, 15000);
  return commit.ok ? { committed: files.length, message: msg } : { committed: 0, message: `failed to commit: ${commit.stderr}` };
}

/** Push ahead commits from superproject master to origin/master */
export async function rollupPushSuperproject(pi: ExtensionAPI, projectCwd: string): Promise<{ pushed: boolean; commits: number }> {
  const fetch = await gitExec(pi, ["fetch", "origin", "--quiet"], projectCwd, 30000);
  if (!fetch.ok) return { pushed: false, commits: 0 };
  const log = await gitExec(pi, ["log", "--oneline", "origin/master..HEAD"], projectCwd, 10000);
  const ahead = parseLines(log.stdout);
  if (ahead.length === 0) return { pushed: false, commits: 0 };
  const push = await gitExec(pi, ["push", "origin", "master"], projectCwd, 30000);
  return { pushed: push.ok, commits: ahead.length };
}
