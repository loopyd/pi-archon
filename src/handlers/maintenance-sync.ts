import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { normalizeError } from "../helpers";
import { parseLines } from "../git-util";

export async function syncOneSubmodule(pi: ExtensionAPI, modPath: string, projectCwd: string): Promise<string[]> {
  try {
    const fetchResult = await pi.exec("git", ["-C", modPath, "fetch", "--quiet", "origin"], { cwd: projectCwd, timeout: 15000 });
    if ((fetchResult.code ?? 0) !== 0) return ["fetch failed"];

    let defaultBranch = "master";
    const headRef = await pi.exec("git", ["-C", modPath, "symbolic-ref", "refs/remotes/origin/HEAD"], { cwd: projectCwd, timeout: 10000 });
    if ((headRef.code ?? 0) === 0) {
      const refMatch = (headRef.stdout ?? "").match(/refs\/remotes\/origin\/(.+)/);
      if (refMatch?.[1]) defaultBranch = refMatch[1];
    }

    const localHash = (await pi.exec("git", ["-C", modPath, "rev-parse", "HEAD"], { cwd: projectCwd, timeout: 10000 })).stdout?.trim();
    const remoteHash = (await pi.exec("git", ["-C", modPath, "rev-parse", `origin/${defaultBranch}`], { cwd: projectCwd, timeout: 10000 })).stdout?.trim();

    if (localHash && remoteHash && localHash !== remoteHash) {
      const behindLog = (await pi.exec("git", ["-C", modPath, "log", "--oneline", `${localHash}..${remoteHash}`], { cwd: projectCwd, timeout: 10000 })).stdout?.trim();
      const behindCount = behindLog ? behindLog.split(/\r?\n/).filter(Boolean).length : 0;
      if (behindCount > 0) {
        const checkout = await pi.exec("git", ["-C", modPath, "checkout", `origin/${defaultBranch}`, "--quiet"], { cwd: projectCwd, timeout: 10000 });
        if ((checkout.code ?? 0) === 0) return [`${behindCount} commit(s) behind → synced`];
      }
    }

    if (localHash && remoteHash) {
      const aheadLog = (await pi.exec("git", ["-C", modPath, "log", "--oneline", `${remoteHash}..${localHash}`], { cwd: projectCwd, timeout: 10000 })).stdout?.trim();
      const aheadCount = aheadLog ? aheadLog.split(/\r?\n/).filter(Boolean).length : 0;
      if (aheadCount > 0) {
        const push = await pi.exec("git", ["-C", modPath, "push", "origin", defaultBranch], { cwd: projectCwd, timeout: 30000 });
        if ((push.code ?? 0) === 0) return [`${aheadCount} commit(s) ahead → pushed`];
        return [`push failed (${(push.stderr ?? "").slice(0, 80)})`];
      }
    }

    return ["aligned"];
  } catch (e) {
    return [`error: ${normalizeError(e)}`];
  }
}

export async function syncCommitPointerChangesSelfContained(pi: ExtensionAPI, projectCwd: string): Promise<string[]> {
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
