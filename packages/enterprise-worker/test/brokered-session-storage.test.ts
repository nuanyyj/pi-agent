import { describe, expect, it } from "vitest";
import { createBrokeredHarness, type BrokeredHarnessResult } from "../src/brokered-runtime";

describe("brokered session storage", () => {
  it("exports createBrokeredHarness", () => {
    expect(createBrokeredHarness).toBeDefined();
    expect(typeof createBrokeredHarness).toBe("function");
  });
});
