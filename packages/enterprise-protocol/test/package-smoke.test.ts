import { describe, expect, it } from "vitest";
import { ENTERPRISE_PROTOCOL_VERSION } from "../src/index";

describe("enterprise-protocol package", () => {
  it("exposes the enterprise protocol version", () => {
    expect(ENTERPRISE_PROTOCOL_VERSION).toBe(1);
  });
});
