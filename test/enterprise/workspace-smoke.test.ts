import { describe, expect, it } from "vitest";
import { ENTERPRISE_PROTOCOL_VERSION } from "../../packages/enterprise-protocol/src/index.ts";
import { ENTERPRISE_WORKER_KIND } from "../../packages/enterprise-worker/src/index.ts";

describe("enterprise workspace", () => {
  it("exposes stable package identities", () => {
    expect(ENTERPRISE_PROTOCOL_VERSION).toBe(1);
    expect(ENTERPRISE_WORKER_KIND).toBe("stage-a-worker");
  });
});
