import type { RunStatus } from "./run-repo";

export function canWorkerFinalizeRun(status: RunStatus): boolean {
  return status === "pending" || status === "running";
}
