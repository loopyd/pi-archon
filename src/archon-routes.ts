import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";

interface ArchonRouteRequest {
  body?: {
    command?: string;
    args?: string;
  };
}

interface RouteCapableExtensionAPI extends ExtensionAPI {
  registerRoute(route: {
    path: string;
    method: "POST";
    schema: typeof archonRouteSchema;
    handler: (req: ArchonRouteRequest) => Promise<unknown>;
  }): void;
}
import { emitArchonMessage, formatArchonMessage, formatToolTextResult, splitArgs } from "./helpers";
import { resolveTokens, generateHelpForPath, isHelpTrigger } from "./command-tree";
import { archonRouteSchema, archonToolBlocked, blockedToolResult, handleCliFallback, handleToolCommand } from "./archon-dispatch";


export function registerArchonTools(pi: ExtensionAPI): void {
  const routeApi = pi as RouteCapableExtensionAPI;
  routeApi.registerRoute({
    path: "/archon",
    method: "POST",
    schema: archonRouteSchema,
    handler: async (req: ArchonRouteRequest) => {
      const cmd = req.body?.command ?? "";
      const args = req.body?.args ?? "";
      const cwd = process.cwd();
      try {
        if (archonToolBlocked(cwd) && cmd !== "help") return blockedToolResult(cwd);
        return await handleToolCommand(pi as ExtensionAPI, cmd, args, cwd);
      } catch (error) {
        const msg = String(error ?? "unknown");
        return formatToolTextResult(formatArchonMessage("`" + msg + "`"), { error: msg });
      }
    },
  });
}

// ─── CLI command routing (rewired through command-tree registry) ──

export async function registerCliRoutes(pi: ExtensionAPI, ctx: ExtensionCommandContext): Promise<void> {
  const tokens = splitArgs(String(ctx.args ?? ""));
  const projectCwd = ctx.cwd || process.cwd();

  // ── Help at top level (no subcommand given or bare help token) ──
  if (!tokens.length || isHelpTrigger(tokens) && tokens.length <= 1) {
    emitArchonMessage(pi, generateHelpForPath([]));
    return;
  }

  // ── Resolve against the metadata tree ──
  const result = resolveTokens([...tokens]);

  // Check if a help-trigger appears anywhere in remaining args
  if (isHelpTrigger(result.rest)) {
    emitArchonMessage(pi, generateHelpForPath(tokens.slice(0, tokens.length - result.rest.length)));
    return;
  }

  // Tokens exhausted on matched group/meta — render scoped help
  // instead of falling through to legacy dispatch.
  if (!result.handler && result.meta) {
    emitArchonMessage(pi, generateHelpForPath(tokens));
    return;
  }

  // ── Dispatch to concrete handler ──
  if (result.handler) {
    await result.handler.execute(pi, result.rest, ctx);
    return;
  }

  await handleCliFallback(pi, ctx, tokens, projectCwd);
}

