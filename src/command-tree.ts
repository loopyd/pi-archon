import type { CommandGroupMeta, PositionalArg, SubCommandMeta } from "./commands/defs";
import type { ArchonCommand } from "./commands/base";
import { archonGroups, commandHandlers } from "./commands";
import { isHandlerKey } from "./handlers/registry";
import { readProjectWorkflowNamesFromDisk } from "./workflow-discovery";
import { isGroup } from "./commands/defs";

export const archonTree: CommandGroupMeta = {
  name: "archon",
  description: "Archon workspace launcher",
  category: "",
  children: archonGroups,
};

export interface CompletionItem {
  value: string;
  label: string;
}

export type ScopedCommandMeta = SubCommandMeta & { path: string };
export type ScopedGroupMeta = CommandGroupMeta & { path: string };

function getScopedNodes(nodes: Array<SubCommandMeta | CommandGroupMeta>, prefix = ""): Array<ScopedCommandMeta | ScopedGroupMeta> {
  const scoped: Array<ScopedCommandMeta | ScopedGroupMeta> = [];
  for (const node of nodes) {
    const path = `${prefix}${node.name}`.trim();
    if (isGroup(node)) {
      const group = { ...node, path };
      scoped.push(group, ...getScopedNodes(node.children, `${path} `));
      continue;
    }
    scoped.push({ ...node, path });
  }
  return scoped;
}

const scopedNodes = getScopedNodes(archonTree.children);
const scopedCommands = scopedNodes.filter((node): node is ScopedCommandMeta => !isGroup(node));
const scopedGroups = scopedNodes.filter((node): node is ScopedGroupMeta => isGroup(node));
const scopedCommandByHandlerKey = new Map(scopedCommands.map((node) => [node.path.replace(/ /g, ":"), node]));
const directScopedCommandsByGroupPath = new Map(
  scopedGroups.map((group) => {
    const prefix = `${group.path} `;
    const children = scopedCommands.filter((node) => node.path.startsWith(prefix) && !node.path.slice(prefix.length).includes(" "));
    return [group.path, children] as const;
  })
);
const resolverIndex = new Map<string, Map<string, ScopedCommandMeta | ScopedGroupMeta>>();
for (const group of scopedGroups) {
  resolverIndex.set(group.path, new Map());
}
resolverIndex.set("", new Map());
for (const node of scopedNodes) {
  const parts = node.path.split(" ");
  const parentPath = parts.slice(0, -1).join(" ");
  const siblings = resolverIndex.get(parentPath) ?? new Map<string, ScopedCommandMeta | ScopedGroupMeta>();
  siblings.set(node.name.toLowerCase(), node);
  resolverIndex.set(parentPath, siblings);
}

export function buildCompletions(): CompletionItem[] {
  const items: CompletionItem[] = [];
  for (const node of scopedNodes) {
    if (isGroup(node)) {
      items.push({ value: node.path, label: node.description || node.path });
      continue;
    }
    items.push({ value: formatInvocationPath(node.path, node.args), label: node.description || node.path });
  }
  for (const workflow of readProjectWorkflowNamesFromDisk(process.cwd())) {
    items.push({ value: `workflow run ${workflow}`, label: `Run workflow ${workflow}` });
  }
  items.push({ value: "-h", label: "Show per-command help" }, { value: "--help", label: "Show per-command help (long form)" }, { value: "help", label: "Show full help" });
  return items;
}

export function getAllLeaves(): ScopedCommandMeta[] {
  return [...scopedCommands];
}

export function getHandler(path: string): ArchonCommand | undefined {
  const lower = path.toLowerCase();
  if (!isHandlerKey(lower)) return undefined;
  return commandHandlers.get(lower);
}

export interface DispatchResult {
  handler?: ArchonCommand;
  path: string;
  rest: string[];
  meta?: ScopedCommandMeta | ScopedGroupMeta;
}

export function resolveTokens(tokens: string[]): DispatchResult {
  const pathParts: string[] = [];
  let lastGroup: ScopedGroupMeta | undefined;
  while (tokens.length) {
    const token = tokens.shift()!;
    const lower = token.toLowerCase();
    const parentPath = pathParts.join(" ");
    const match = resolverIndex.get(parentPath)?.get(lower);
    if (!match) return { path: pathParts.join(":"), rest: [token, ...tokens], meta: lastGroup };
    pathParts.push(match.name);
    if (isGroup(match)) {
      lastGroup = match;
      continue;
    }
    return { handler: getHandler(pathParts.join(":")), path: pathParts.join(":"), meta: match, rest: [...tokens] };
  }
  return { path: pathParts.join(":"), rest: [], meta: lastGroup };
}

export function resolveCommandPath(command: string, args: string[]): DispatchResult {
  return resolveTokens(command.split(":").filter(Boolean).concat(args));
}

const HELP_TOKENS = new Set(["help", "-h", "--help"]);

export function isHelpTrigger(args: string[]): boolean {
  return args.some((arg) => HELP_TOKENS.has(arg.toLowerCase()));
}

export function formatInvocationPath(path: string, args?: PositionalArg[]): string {
  return `${path}${args?.length ? ` ${args.map((arg) => `<${arg.name}>`).join(" ")}` : ""}`;
}

export function formatInvocation(path: string, args?: PositionalArg[]): string {
  return `/archon ${formatInvocationPath(path, args)}`;
}

function getScopedGroups(): ScopedGroupMeta[] {
  return scopedGroups;
}

function getDirectScopedCommands(group: ScopedGroupMeta): ScopedCommandMeta[] {
  return directScopedCommandsByGroupPath.get(group.path) ?? [];
}

export function generateFullHelp(): string {
  const lines: string[] = ["## Archon", ""];
  for (const group of getScopedGroups()) {
    if (group.path.includes(" ")) continue;
    lines.push(`### ${group.category ?? group.name}`, "", `${group.description}`, "");
    for (const child of getDirectScopedCommands(group)) {
      lines.push(`- \`${formatInvocation(child.path, child.args)}\` — ${child.description}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

export function getScopedMetaByHandlerKey(handlerKey: string): ScopedCommandMeta | undefined {
  return scopedCommandByHandlerKey.get(handlerKey);
}

export function generateHelpForPath(tokens: string[]): string {
  if (!tokens.length || isHelpTrigger(tokens)) return generateFullHelp();
  const result = resolveTokens([...tokens]);
  if (result.meta) return isGroup(result.meta) ? generateGroupHelp(result.meta) : generateScopedHelp(result.meta);
  return generateFullHelp();
}

export function generateScopedHelp(node: ScopedCommandMeta): string {
  const lines: string[] = [`## /archon ${node.path}`, "", node.description];
  if (node.args?.length) {
    lines.push("", "### Arguments");
    for (const arg of node.args) lines.push(`- \`${arg.name}\`${arg.required ? " *(required)*" : ""}: ${arg.description ?? ""}`);
  }
  if (node.flags?.length) {
    lines.push("", "### Flags");
    for (const flag of node.flags) lines.push(`- ${(flag.aliases?.map((alias) => `${alias}, `).join("") ?? "")}\`${flag.name}\`: ${flag.description ?? ""}`);
  }
  if (node.examples?.length) {
    lines.push("", "### Examples");
    for (const example of node.examples) lines.push("```bash", example, "```");
  }
  lines.push("");
  return lines.join("\n");
}

export function generateGroupHelp(group: ScopedGroupMeta): string {
  const lines: string[] = [`## /archon ${group.path}`, "", group.description, ""];
  const children = getDirectScopedCommands(group);
  if (children.length) {
    lines.push("### Sub-commands", "");
    for (const child of children) {
      lines.push(`- \`${formatInvocation(child.path, child.args)}\` — ${child.description}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}
