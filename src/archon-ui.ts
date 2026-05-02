import type { WorkflowName } from "./types";
import { WORKFLOWS } from "./constants";
import { normalizeString } from "./helpers";

/** Normalize a raw value into a valid workflow name, defaulting to `"plan"` */
export function normalizeWorkflow(value: unknown): WorkflowName {
  const w = normalizeString(value) || "plan";
  return (WORKFLOWS as readonly string[]).includes(w) ? (w as WorkflowName) : "plan";
}
