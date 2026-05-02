import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { createMessageEmitter } from "./helpers";
import { generateScopedHelp, generateFullHelp } from "./command-tree";

// ════════════════════════════════════════════════════════════════
// Metadata types (merged from command-meta.ts)
// ════════════════════════════════════════════════════════════════

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
  aliases?: string[];
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

/** Type guard: does this node carry children? */
export function isGroup(node: CommandNode): node is CommandGroupMeta {
  return "children" in node && Array.isArray((node as CommandGroupMeta).children);
}

// ─── Help-trigger tokens recognised at every level ──────────────

const HELP_TOKENS = new Set(["help", "-h", "--help"]);
const emitArchon = createMessageEmitter("archon");

// ─── Abstract base — every Archon command inherits from this ─────────

/**
 * Base class for all `/archon` commands and sub-commands.
 *
 * Each subclass declares its metadata via `static meta`.
 * The registry aggregates all subclasses into a single dispatchable tree
 * and generates help text automatically.
 */
export abstract class ArchonCommand {
  // ── Metadata declared by each subclass ──────────────────────────

  /** Unique key used internally for the registry lookup map */
  static readonly _key = Symbol.for(`cmd:${(ArchonCommand as any)._counter++}`);

  protected static _counter = 0;

  /** Override in subclass to declare metadata for this command */
  static readonly meta = {} as CommandNode;

  /** Execute handler — receives remaining args after this node was matched */
  abstract execute(pi: ExtensionAPI, args: string[], ctx: ExtensionCommandContext): Promise<void>;

  // ── Instance helper — emit scoped help and short-circuit ──────────

  /**
   * Emit per-command help for *this* command's metadata.
   * Call at the top of `execute()` when you want belt-and-suspenders
   * `-h / --help / help` support even via legacy dispatch paths.
   *
   * Returns `true` when a help token was consumed so callers can early-return.
   */
  showHelpIfRequested(pi: ExtensionAPI, args: string[]): boolean {
    if (findHelpToken(args) < 0) return false;
    const meta = (this.constructor as typeof ArchonCommand).meta;
    emitArchon(pi, isGroup(meta) ? generateFullHelp() : generateScopedHelp(meta));
    return true;
  }

  // ── Static helpers (inherited by every subclass) ────────────────

  /** Return true when `args` begins with a help trigger token */
  static isHelp(args: string[]): boolean {
    if (!args.length) return false;
    return HELP_TOKENS.has(args[0].toLowerCase());
  }

  /** Render categorized help listing for an array of nodes */
  static renderHelpFor(nodes: Array<SubCommandMeta | CommandGroupMeta>): string {
    const lines: string[] = [];
    const categories = new Map<string, typeof nodes>();

    for (const n of nodes) {
      const cat = n.category ?? "General";
      const bucket = categories.get(cat) ?? [];
      bucket.push(n);
      categories.set(cat, bucket);
    }

    for (const [cat, items] of categories.entries()) {
      lines.push(`### ${cat}`, "");
      for (const item of items) {
        lines.push(`- \`${buildInvocationName(item.name, !isGroup(item) ? item.args : undefined)}\` — ${item.description}`);
      }
      lines.push("");
    }

    return lines.join("\n");
  }

  /** Full top-level help markdown including title banner */
  static renderFullHelp(title = "## Archon"): string {
    return [title, "", this.renderHelpFor(ArchonRegistry.getAllLeaves()), ""].join("\n");
  }
}

// ─── Invocation-name builder ────────────────────────────────────

function buildInvocationName(name: string, args?: PositionalArg[]): string {
  let s = `/archon ${name}`;
  if (args?.length) s += " " + args.map((a) => `<${a.name}>`).join(" ");
  return s;
}

// ─── Registry — collects all subclasses into a dispatch tree ─────

/**
 * Central registry that discovers every registered ArchonCommand subclass
 * and builds the command routing table.
 */
export class ArchonRegistry {
  private static _instances = new Map<string, ArchonCommand>();

  /** Register a single command instance keyed by canonical path */
  static register(path: string, cmd: ArchonCommand): void {
    this._instances.set(path, cmd);
  }

  /** Resolve tokens to matching handler via metadata tree walk */
  static resolve(tokens: string[], tree: CommandGroupMeta): ArchonCommand | undefined {
    if (!tokens.length || tokens[0] === "") return undefined;
    const match = findChild(tokens[0], tree.children);
    if (!match) return undefined;

    if (isGroup(match)) return this.resolve(tokens.slice(1), match);

    return this._instances.get([...tokens].join(":"));
  }

  /** Return flat leaf commands in registration order */
  static getAllLeaves(tree: CommandGroupMeta = this.buildDefaultTree()): SubCommandMeta[] {
    const leaves: SubCommandMeta[] = [];
    walkLeaves(tree.children, leaves);
    return leaves;
  }

  protected static buildDefaultTree(): CommandGroupMeta {
    return { name: "", description: "", category: "", children: [] };
  }

  /** Check whether any help-trigger was passed at current or deeper levels */
  static checkHelpTrigger(args: string[]): boolean {
    return args.some((a) => HELP_TOKENS.has(a.toLowerCase()));
  }
}

// ─── Helpers ──────────────────────────────────────────────────────

function findHelpToken(args: string[]): number {
  for (let i = 0; i < args.length; i++) {
    if (HELP_TOKENS.has(args[i].toLowerCase())) return i;
  }
  return -1;
}

function findChild(token: string, children: Array<SubCommandMeta | CommandGroupMeta>): (SubCommandMeta | CommandGroupMeta) | undefined {
  const lower = token.toLowerCase();
  return children.find((c) => c.name.toLowerCase() === lower || (c.aliases ?? []).some((a) => a.toLowerCase() === lower));
}

function walkLeaves(nodes: Array<SubCommandMeta | CommandGroupMeta>, out: SubCommandMeta[]): void {
  for (const n of nodes) {
    if (isGroup(n)) walkLeaves(n.children, out);
    else out.push(n);
  }
}
