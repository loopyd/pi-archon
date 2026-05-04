import { ArchonCommand } from "./base";
import { defineCommandEntries } from "./defs";
import type { CommandGroupMeta, SubCommandMeta } from "./defs";

export class ServerStartCommand extends ArchonCommand {
  static override meta: SubCommandMeta = { name: "start", description: "Start Archon backend API server.", category: "Server", examples: ["/archon server start"] };
  static override handlerKey = "server:start";
}

export class ServerStopCommand extends ArchonCommand {
  static override meta: SubCommandMeta = { name: "stop", description: "Stop Archon backend API server.", category: "Server", examples: ["/archon server stop"] };
  static override handlerKey = "server:stop";
}

export class ServerStatusCommand extends ArchonCommand {
  static override meta: SubCommandMeta = { name: "status", description: "Check server health.", category: "Server", examples: ["/archon server status"] };
  static override handlerKey = "server:status";
}

export const serverGroup: CommandGroupMeta = {
  name: "server",
  description: "Manage @archon/server backend API.",
  category: "Server",
  children: [ServerStartCommand.meta, ServerStopCommand.meta, ServerStatusCommand.meta],
};

export const serverCommandEntries = defineCommandEntries([
  ["server:start", ServerStartCommand],
  ["server:stop", ServerStopCommand],
  ["server:status", ServerStatusCommand],
] as const);
