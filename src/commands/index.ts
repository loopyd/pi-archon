import { workflowCommandEntries, workflowsGroup } from "./workflow";
import { manageCommandEntries, managementGroup } from "./manage";
import { serverCommandEntries, serverGroup } from "./server";
import { webCommandEntries, webGroup } from "./web";
import { defineCommandEntries } from "./defs";
import type { CommandEntry, CommandGroupMeta } from "./defs";
import type { ArchonCommand } from "./base";
import type { ArchonHandlerKey } from "../handlers/registry";

export const archonGroups: CommandGroupMeta[] = [workflowsGroup, managementGroup, serverGroup, webGroup];

export const commandEntries: CommandEntry[] = defineCommandEntries([
  ...workflowCommandEntries,
  ...manageCommandEntries,
  ...serverCommandEntries,
  ...webCommandEntries,
]);

export const commandHandlers = new Map<ArchonHandlerKey, ArchonCommand>(
  commandEntries.map(([key, Command]) => [key, new Command()])
);
