import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { normalizeError } from "../helpers";
import { rollupSubmodules, checkSubmodules } from "../git-util";
import type { CleanupSubmoduleEntry } from "../types";

interface CleanupSubmoduleEntryExtended extends CleanupSubmoduleEntry {
  name: string;
  path: string;
  commit: string;
  upToDate: boolean;
  dirty: boolean;
}

export async function syncSubmodulesWithRemotesStep(pi: ExtensionAPI, projectCwd: string): Promise<string[]> {
  try {
    const result = await rollupSubmodules(pi, projectCwd);
    const lines: string[] = [];
    if (result.errors.length > 0) lines.push(`Errors: ${result.errors.join(", ")}`);
    if (result.updated.length > 0) lines.push(`Updated ${result.updated.length} behind submodule(s)`);
    if (result.pushed.length > 0) lines.push(`Pushed ahead to origin in ${result.pushed.map((path) => `\`${path}\``).join(", ")}`);
    if (lines.length === 0) lines.push("All submodules aligned with remotes.");
    return lines;
  } catch (e) {
    return [normalizeError(e)];
  }
}

export async function checkSubmoduleHealthStatusStep(pi: ExtensionAPI, projectCwd: string): Promise<string[]> {
  try {
    const entries: CleanupSubmoduleEntryExtended[] = await checkSubmodules(pi, projectCwd);
    const lines: string[] = [];
    for (const entry of entries) {
      const status = !entry.upToDate && !entry.dirty ? "⬇️ behind" : entry.dirty ? "🏷️ modified" : "✅ up-to-date";
      lines.push(`${entry.name}: ${status} (${entry.commit})`);
    }
    return lines;
  } catch (e) {
    return [normalizeError(e)];
  }
}
