import { describe, expect, it } from "vitest";
import { canWorkerFinalizeRun } from "../../lib/enterprise/run-lifecycle";

describe("canWorkerFinalizeRun", () => {
  it("allows a running or pending worker to publish its terminal result", () => {
    expect(canWorkerFinalizeRun("pending")).toBe(true);
    expect(canWorkerFinalizeRun("running")).toBe(true);
  });

  it("does not overwrite a terminal status selected by another control path", () => {
    expect(canWorkerFinalizeRun("cancelled")).toBe(false);
    expect(canWorkerFinalizeRun("completed")).toBe(false);
    expect(canWorkerFinalizeRun("failed")).toBe(false);
  });
});
