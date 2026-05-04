import type { ArchonCommand } from "./base";
import type { ArchonHandlerKey } from "../handlers/registry";

export interface PositionalArg {
  name: string;
  description?: string;
  required?: boolean;
}

export interface FlagDef {
  name: string;
  aliases?: string[];
  description?: string;
  type?: "boolean" | "string";
}

export interface SubCommandMeta {
  name: string;
  description: string;
  category?: string;
  args?: PositionalArg[];
  flags?: FlagDef[];
  examples?: string[];
}

export interface CommandGroupMeta extends Omit<SubCommandMeta, "args" | "flags"> {
  children: Array<SubCommandMeta | CommandGroupMeta>;
}

export type CommandNode = SubCommandMeta | CommandGroupMeta;

export function isGroup(node: CommandNode): node is CommandGroupMeta {
  return "children" in node && Array.isArray((node as CommandGroupMeta).children);
}

export type ArchonCommandClass = new () => ArchonCommand;
export type CommandEntry = readonly [ArchonHandlerKey, ArchonCommandClass];

export function defineCommandEntries<const T extends readonly CommandEntry[]>(entries: T): T {
  return entries;
}
