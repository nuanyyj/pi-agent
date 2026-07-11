import { describe, expect, it } from "vitest";
import { ENTERPRISE_WORKER_KIND } from "../src/index";

describe("enterprise-worker package", () => {
  it("exposes the enterprise worker kind", () => {
    expect(ENTERPRISE_WORKER_KIND).toBe("stage-a-worker");
  });
});
