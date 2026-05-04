import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { emitArchonMessage, formatArchonMessage, maybeString } from "../helpers";
import { ArchonCommand, HelpableArchonCommand, HelpFilteringArchonCommand } from "./base";
import { defineCommandEntries } from "./defs";
import type { CommandGroupMeta, SubCommandMeta } from "./defs";


export class StatusCommand extends ArchonCommand {
  static override meta: SubCommandMeta = { name: "status", description: "Show Archon project status.", category: "Management", examples: ["/archon manage status"] };
  static override handlerKey = "manage:status";
}

export class CancelWorkflowCommand extends ArchonCommand {
  static override handlerKey = "manage:cancel";

  static override meta: SubCommandMeta = {
    name: "cancel",
    description: "Cancel active Archon workflow run by id.",
    category: "Management",
    args: [{ name: "runId", required: true, description: "Workflow run id" }],
    examples: ["/archon manage cancel 9c448e6d"],
  };

  async execute(pi: ExtensionAPI, args: string[], ctx: ExtensionCommandContext): Promise<void> {
    const runId = maybeString(args.join(" ").trim());
    if (!runId) {
      emitArchonMessage(pi, formatArchonMessage("- **Missing run id**", "", "```bash", "/archon manage cancel <runId>", "```"));
      return;
    }
    await this.handler.run(pi, ctx, [runId]);
  }
}

export class CleanupCommand extends HelpFilteringArchonCommand {
  static override handlerKey = "manage:cleanup";

  static override meta: SubCommandMeta = {
    name: "cleanup",
    description: "Prune worktrees, stale refs, sync submodules.",
    category: "Management",
    examples: ["/archon manage cleanup"],
  };

}

export class SyncSubmodulesCommand extends HelpableArchonCommand {
  static override meta: SubCommandMeta = { name: "sync-submodules", description: "Fetch + prune submodule remotes.", category: "Management", examples: ["/archon manage sync-submodules"] };
  static override handlerKey = "manage:sync-submodules";
}

export class UpdateCommand extends HelpableArchonCommand {
  static override meta: SubCommandMeta = { name: "update", description: "Pull /opt/archon from origin, preserving local config changes.", category: "Management", examples: ["/archon manage update"] };
  static override handlerKey = "manage:update";
}

export const managementGroup: CommandGroupMeta = {
  name: "manage",
  description: "Project status, cleanup, and submodule maintenance.",
  category: "Management",
  children: [StatusCommand.meta, CancelWorkflowCommand.meta, CleanupCommand.meta, SyncSubmodulesCommand.meta, UpdateCommand.meta],
};

export const manageCommandEntries = defineCommandEntries([
  ["manage:status", StatusCommand],
  ["manage:cancel", CancelWorkflowCommand],
  ["manage:cleanup", CleanupCommand],
  ["manage:sync-submodules", SyncSubmodulesCommand],
  ["manage:update", UpdateCommand],
] as const);
