import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { emitArchonMessage, formatArchonMessage, maybeString } from "../helpers";
import { findProjectWorkflow } from "../workflow-discovery";
import { ArchonCommand } from "./base";
import { defineCommandEntries } from "./defs";
import type { CommandGroupMeta, SubCommandMeta } from "./defs";


export class RunWorkflowCommand extends ArchonCommand {
  static override meta: SubCommandMeta = {
    name: "run",
    description: "Run project workflow by name from `.archon/workflows/`.",
    category: "Workflows",
    args: [
      { name: "workflow", required: true, description: "Workflow name" },
      { name: "query", required: false, description: "Optional workflow prompt/query" },
    ],
    examples: ["/archon workflow run bof3-plan refactor auth module"],
  };
  static override handlerKey = "workflow:run";

  async execute(pi: ExtensionAPI, args: string[], ctx: ExtensionCommandContext): Promise<void> {
    const workflow = maybeString(args[0]);
    if (!workflow) {
      emitArchonMessage(pi, formatArchonMessage("- **Missing workflow name**", "", "```bash", "/archon workflow run <workflow> [query]", "```"));
      return;
    }
    const resolved = await findProjectWorkflow(workflow, ctx.cwd || process.cwd());
    if (!resolved) {
      emitArchonMessage(pi, formatArchonMessage(`- **Unknown workflow:** \`${workflow}\``));
      return;
    }
    await super.execute(pi, [resolved, ...args.slice(1)], ctx);
  }
}

export const workflowsGroup: CommandGroupMeta = {
  name: "workflow",
  description: "Run project workflows discovered from `.archon/workflows/`.",
  category: "Workflows",
  children: [RunWorkflowCommand.meta],
};

export const workflowCommandEntries = defineCommandEntries([
  ["workflow:run", RunWorkflowCommand],
] as const);
