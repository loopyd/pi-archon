import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { ARCHON_PILL_UPDATE, ARCHON_ROOT } from "../constants";
import { emitArchonMessage, formatElapsed, normalizeError } from "../helpers";
import { safeCode } from "../output-filter";
import * as fs from "node:fs";

// ─── Git helpers ──────────────────────────────────────────────────────

interface GitResult {
  stdout: string;
  stderr: string;
  code: number;
}

async function git(pi: ExtensionAPI, args: string[], cwd?: string): Promise<GitResult> {
  const result = await pi.exec("git", args, { cwd: cwd ?? ARCHON_ROOT, timeout: 30000 });
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    code: result.code ?? 0,
  };
}

// ─── Update pipeline ──────────────────────────────────────────────────

export async function handleArchonUpdateCommand(
  pi: ExtensionAPI,
  _args: string[],
  ctx: ExtensionCommandContext
): Promise<void> {
  const startMs = Date.now();
  const lines: string[] = [];
  const root = ARCHON_ROOT;

  // 0. Verify archon root exists and is a git repo
  if (!fs.existsSync(`${root}/.git`)) {
    emitArchonMessage(pi, `## Archon update failed\n\n- **Error:** \`${safeCode(root)}\` is not a git repository\n`, { pill: ARCHON_PILL_UPDATE });
    return;
  }

  lines.push(`- **Archon root:** \`${safeCode(root)}\``);

  // 1. Capture current branch
  const branchOut = await git(pi, ["branch", "--show-current"]);
  const branch = branchOut.stdout.trim();
  if (!branch) {
    emitArchonMessage(pi, `## Archon update failed\n\n- **Error:** detached HEAD at \`${safeCode(root)}\`\n`, { pill: ARCHON_PILL_UPDATE });
    return;
  }
  lines.push(`- **Branch:** \`${safeCode(branch)}\``);

  // 2. Identify local changes
  const statusOut = await git(pi, ["status", "--porcelain"]);
  const statusLines = statusOut.stdout.split(/\r?\n/).filter((l) => l.length > 0);
  const modifiedFiles = statusLines
    .filter((l) => !l.startsWith("??"))
    .map((l) => l.slice(3).trim())
    .filter(Boolean);
  const untrackedFiles = statusLines
    .filter((l) => l.startsWith("??"))
    .map((l) => l.slice(3).trim())
    .filter(Boolean);

  const hasLocalChanges = modifiedFiles.length > 0;
  lines.push(`- **Modified tracked files:** ${modifiedFiles.length}`);
  lines.push(`- **Untracked files:** ${untrackedFiles.length}`);

  let stashRef: string | null = null;

  try {
    // 3. Stash local changes if any
    if (hasLocalChanges) {
      const stashMsg = `archon-update-auto-stash-${Date.now()}`;
      const stashOut = await git(pi, ["stash", "push", "-m", stashMsg, "--", ...modifiedFiles]);
      if ((stashOut.code ?? 1) !== 0) {
        throw new Error(`stash failed: ${stashOut.stderr}`);
      }
      stashRef = "auto-stash";
      lines.push(`- **Stashed:** ${modifiedFiles.length} file(s) (\`${stashMsg}\`)`);
    }

    // 4. Fetch + pull
    await git(pi, ["fetch", "origin"]);
    const pullOut = await git(pi, ["pull", "origin", branch]);
    const pullStdout = (pullOut.stdout ?? "").trim();
    const pullStderr = (pullOut.stderr ?? "").trim();

    if ((pullOut.code ?? 0) === 0) {
      if (pullStdout.includes("Already up to date") || pullStdout.includes("Up-to-date")) {
        lines.push(`- **Pull:** already up to date`);
      } else {
        const updatedCount = pullStdout.split(/\r?\n/).filter((l) => l.includes("|")).length;
        lines.push(`- **Pull:** updated (${updatedCount} file(s) changed)`);
      }
    } else {
      throw new Error(`pull failed: ${pullStderr || pullStdout}`);
    }

    // 5. Re-apply stash
    if (stashRef) {
      const popOut = await git(pi, ["stash", "pop", "stash@{0}"]);
      if ((popOut.code ?? 0) !== 0) {
        // Stash pop conflict — re-apply stash so changes aren't lost
        await git(pi, ["stash", "apply", "stash@{0}"]);
        const conflictFiles = popOut.stdout.split(/\r?\n/)
          .filter((l) => l.includes("CONFLICT") || l.startsWith("UU"))
          .map((l) => safeCode(l.trim()));
        lines.push(`- **Stash pop:** conflicts detected (${conflictFiles.length} file(s))`);
        lines.push(`- **Action needed:** resolve conflicts manually in \`${safeCode(root)}\``);
        // Don't drop the stash on conflict so user can retry
        lines.push(`- **Stash preserved:** run \`git stash pop\` in \`${safeCode(root)}\` after resolving`);
      } else {
        lines.push(`- **Stash pop:** restored ${modifiedFiles.length} file(s) cleanly`);
      }
    }

    // 6. Show commit distance after update
    const logOut = await git(pi, ["log", "--oneline", "-5", "HEAD"]);
    const recentCommits = logOut.stdout.trim().split(/\r?\n/).filter(Boolean);
    if (recentCommits.length > 0) {
      lines.push(`- **HEAD:** \`${safeCode(recentCommits[0].substring(0, 70))}\``);
    }

    // 7. Summary
    const elapsed = formatElapsed(Math.floor((Date.now() - startMs) / 1000));
    let md = `## Archon update complete\n\n`;
    md += lines.map((l) => `${l}`).join("\n");
    md += `\n- **Duration:** \`${elapsed}\`\n`;

    if (untrackedFiles.length > 0) {
      md += `\n### Untracked files (preserved)\n\n`;
      for (const f of untrackedFiles) {
        md += `- \`${safeCode(f)}\`\n`;
      }
    }

    emitArchonMessage(pi, md, { pill: ARCHON_PILL_UPDATE });
  } catch (error) {
    const message = normalizeError(error);
    let md = `## Archon update failed\n\n`;
    md += lines.map((l) => `${l}`).join("\n");
    md += `\n- **Error:** \`${safeCode(message)}\``;
    md += `\n- **Duration:** \`${formatElapsed(Math.floor((Date.now() - startMs) / 1000))}\`\n`;
    emitArchonMessage(pi, md, { pill: ARCHON_PILL_UPDATE });
  }
}
