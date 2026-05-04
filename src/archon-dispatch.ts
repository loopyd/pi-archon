import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import * as fs from "node:fs";
import { Type } from "typebox";
import { ARCHON_ROOT, ARCHON_TITLE, DEFAULT_QUERY } from "./constants";
import type { ExtensionUiShim, TuiRendererFn, WorkflowName } from "./types";

interface ToolCommandContext extends ExtensionCommandContext {
  cwd: string;
  hasUI: false;
  ui: ExtensionUiShim;
}
import { emitArchonMessage, formatArchonMessage, formatToolTextResult, normalizeString, splitArgs } from "./helpers";
import { redactSecrets, safeCode } from "./output-filter";
import { generateHelpForPath, resolveCommandPath } from "./command-tree";


export const archonRouteSchema = Type.Object({
  command: Type.String(),
  args: Type.Optional(Type.String()),
  options: Type.Optional(Type.Record(Type.String(), Type.Any())),
});

function resolvePathSafe(path: string): string {
  try {
    return fs.realpathSync(path);
  } catch {
    return path;
  }
}

function isWithinPath(path: string, root: string): boolean {
  const resolvedPath = resolvePathSafe(path);
  const resolvedRoot = resolvePathSafe(root);
  return resolvedPath === resolvedRoot || resolvedPath.startsWith(`${resolvedRoot}/`);
}

export function archonToolBlocked(cwd: string): boolean {
  return isWithinPath(cwd, ARCHON_ROOT);
}

export function blockedToolResult(cwd: string) {
  return formatToolTextResult([
    "## Archon tool blocked",
    "",
    `- **Reason:** tool use from inside Archon tree is disabled`,
    `- **cwd:** \`${safeCode(cwd)}\``,
    `- **Archon root:** \`${safeCode(ARCHON_ROOT)}\``,
    "- **Action:** run `/archon ...` manually from user session outside Archon workflow/tool context",
  ].join("\n"), { blocked: true, cwd, archonRoot: ARCHON_ROOT });
}

export async function handleToolCommand(pi: ExtensionAPI, cmd: string, args: string, cwd: string) {
  const argTokens = splitArgs(args);
  if (cmd === "help") return formatToolTextResult(generateHelpForPath(argTokens));

  const helpArgs = argTokens.filter((token) => !["help", "-h", "--help"].includes(token.toLowerCase()));
  if (helpArgs.length !== argTokens.length) {
    return formatToolTextResult(generateHelpForPath(cmd.split(":").concat(helpArgs)));
  }

  const toolCtx: ToolCommandContext = {
    cwd,
    hasUI: false,
    ui: {
      custom: async <T>(_renderer: TuiRendererFn): Promise<T | undefined> => undefined,
      notify: (_message: string, _level?: string) => {},
    },
  };
  const result = resolveCommandPath(cmd, argTokens);
  if (result.handler && result.rest.length === 0) {
    const output = await result.handler.executeTool(pi, [], toolCtx);
    return { ...output, details: { delegated: result.path, ...(output.details ?? {}) } };
  }
  if (result.meta) {
    return formatToolTextResult(generateHelpForPath(cmd.split(":").concat(argTokens)));
  }
  return formatToolTextResult(formatArchonMessage(`- **Unknown:** \`${safeCode(cmd)}\``));
}

export async function handleCliFallback(pi: ExtensionAPI, _ctx: ExtensionCommandContext, tokens: string[], _projectCwd: string) {
  const firstToken = tokens[0]?.toLowerCase() ?? "";
  emitArchonMessage(pi, formatArchonMessage(`- **Unknown:** \`${safeCode(firstToken)}\``));
}


