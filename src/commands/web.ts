import { ArchonCommand } from "./base";
import { defineCommandEntries } from "./defs";
import type { CommandGroupMeta, SubCommandMeta } from "./defs";

export class WebStartCommand extends ArchonCommand {
  static override meta: SubCommandMeta = {
    name: "start",
    description: "Start Archon web frontend.",
    category: "Web Dev",
    flags: [
      { name: "--assistant", type: "string", description: "Assistant identifier (default from config)" },
      { name: "--open", type: "boolean", description: "Open browser after start" },
    ],
    examples: ["/archon web start --assistant pi"],
  };
  static override handlerKey = "web:start";
}

export class WebStopCommand extends ArchonCommand {
  static override meta: SubCommandMeta = { name: "stop", description: "Stop running Archon web frontend processes.", category: "Web Dev", examples: ["/archon web stop"] };
  static override handlerKey = "web:stop";
}

export class WebStatusCommand extends ArchonCommand {
  static override meta: SubCommandMeta = { name: "status", description: "Check web frontend health.", category: "Web Dev", examples: ["/archon web status"] };
  static override handlerKey = "web:status";
}

export const webGroup: CommandGroupMeta = {
  name: "web",
  description: "Manage @archon/web frontend (requires separate /archon server start).",
  category: "Web Dev",
  children: [WebStartCommand.meta, WebStopCommand.meta, WebStatusCommand.meta],
};

export const webCommandEntries = defineCommandEntries([
  ["web:start", WebStartCommand],
  ["web:stop", WebStopCommand],
  ["web:status", WebStatusCommand],
] as const);
