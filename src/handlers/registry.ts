import type { ArchonHandler } from "./base";
import { CleanupHandler, SyncSubmodulesHandler } from "./maintenance-command";
import { ManageCancelHandler, ManageStatusHandler } from "./manage-command";
import { ServerStartHandler, ServerStatusHandler, ServerStopHandler } from "./server-command";
import { UpdateHandler } from "./update-command";
import { WebStartHandler, WebStatusHandler, WebStopHandler } from "./web-command";
import { WorkflowRunHandler } from "./workflow-command";

export function defineHandlerRegistry<const T extends readonly (readonly [ArchonHandlerKey, ArchonHandler])[]>(entries: T): Map<ArchonHandlerKey, ArchonHandler> {
  return new Map<ArchonHandlerKey, ArchonHandler>(entries);
}

export function isHandlerKey(value: string): value is ArchonHandlerKey {
  return handlerRegistry.has(value as ArchonHandlerKey);
}

export type ArchonHandlerKey =
  | "workflow:run"
  | "manage:status"
  | "manage:cancel"
  | "manage:cleanup"
  | "manage:sync-submodules"
  | "manage:update"
  | "server:start"
  | "server:stop"
  | "server:status"
  | "web:start"
  | "web:stop"
  | "web:status";

export const handlerRegistry = defineHandlerRegistry([
  ["workflow:run", new WorkflowRunHandler()],
  ["manage:status", new ManageStatusHandler()],
  ["manage:cancel", new ManageCancelHandler()],
  ["manage:cleanup", new CleanupHandler()],
  ["manage:sync-submodules", new SyncSubmodulesHandler()],
  ["manage:update", new UpdateHandler()],
  ["server:start", new ServerStartHandler()],
  ["server:stop", new ServerStopHandler()],
  ["server:status", new ServerStatusHandler()],
  ["web:start", new WebStartHandler()],
  ["web:stop", new WebStopHandler()],
  ["web:status", new WebStatusHandler()],
] as const);
