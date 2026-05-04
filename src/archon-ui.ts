import type { WorkflowName } from "./types";
import { normalizeString } from "./helpers";

export function normalizeWorkflow(value: unknown, workflows: Iterable<string>): WorkflowName | undefined {
  const w = normalizeString(value);
  if (!w) return undefined;
  const known = new Set(workflows);
  return known.has(w) ? w : undefined;
}
