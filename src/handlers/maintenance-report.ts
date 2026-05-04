import { formatElapsed } from "../helpers";
import type { StepResult } from "../types";

export function renderCleanupReport(steps: StepResult[], totalDuration: number): string {
  let md = `## Archon Workspace Cleanup Report\n\n`;
  md += `- **Duration:** \`${formatElapsed(Math.floor(totalDuration / 1000))}\`\n`;
  md += `- **Total sections:** ${steps.length}\n`;
  md += `\n---\n\n`;

  for (const step of steps) {
    md += `### ${step.title}\n\n`;
    md += `${step.lines.map((line) => `- ${line}`).join("\n")}`;
    md += `\n- **Section time:** \`${formatElapsed(Math.floor(step.durationMs / 1000))}\`\n`;
    md += "\n---\n\n";
  }
  return md;
}

export function countOutcome(results: StepResult[], marker: string): number {
  return results.reduce((sum, result) => sum + result.lines.filter((line) => line.includes(marker)).length, 0);
}

export function renderSyncSubmodulesReport(results: StepResult[], durationMs: number): string {
  const updated = countOutcome(results, "→ synced");
  const pushed = countOutcome(results, "→ pushed");
  const errs = results.filter((result) => !result.ok).length;
  const lines: string[] = [];
  if (errs > 0) lines.push(`${errs} submodule(s) had errors`);
  if (updated > 0) lines.push(`Updated ${updated} behind submodule(s)`);
  if (pushed > 0) lines.push(`Pushed ahead in ${pushed} submodule(s)`);
  if (lines.length === 0) lines.push("All submodules aligned with remotes.");
  return `## Submodule sync\n\n${lines.join("\n")}\n\n- **Duration:** \`${formatElapsed(Math.floor(durationMs / 1000))}\`\n`;
}
