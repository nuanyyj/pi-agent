import { describe, expect, it } from "vitest";
import { ENTERPRISE_SESSION_BROKER_KIND } from "../src/index";

describe("enterprise session broker package", () => {
  it("exports the package kind", () => {
    expect(ENTERPRISE_SESSION_BROKER_KIND).toBe("postgres-session-broker");
  });
});
