import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { readSubmodulePaths } from "../git-util";
import { runRuntimeProgress } from "../commands/runtime";
import { ArchonHandler } from "./base";
import { buildCleanupSteps } from "./maintenance-runtime";
import { renderCleanupReport, renderSyncSubmodulesReport } from "./maintenance-report";
import { syncCommitPointerChangesSelfContained, syncOneSubmodule } from "./maintenance-sync";

export class CleanupHandler extends ArchonHandler {
  async run(pi: ExtensionAPI, ctx: ExtensionCommandContext, _args: string[]): Promise<void> {
    const projectRoot = ctx.cwd || process.cwd();

    await runRuntimeProgress(pi, ctx, {
      title: "cleanup",
      steps: () => buildCleanupSteps(pi, projectRoot),
      maxLines: 8,
      renderReport: renderCleanupReport,
      successLabel: "Archon cleanup complete.",
      errorLabel: "Archon cleanup finished with errors.",
    });
  }
}

export class SyncSubmodulesHandler extends ArchonHandler {
  async run(pi: ExtensionAPI, ctx: ExtensionCommandContext, _args: string[]): Promise<void> {
    const projectCwd = ctx.cwd || process.cwd();
    const submodPaths = readSubmodulePaths(projectCwd);

    await runRuntimeProgress(pi, ctx, {
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
      renderReport: renderSyncSubmodulesReport,
      successLabel: "Submodule sync complete.",
      errorLabel: "Submodule sync finished with errors.",
    });
  }
}
