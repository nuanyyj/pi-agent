import { describe, expect, it } from "vitest";
import { createApprovedCodingTools } from "../src/coding-tools";

describe("createApprovedCodingTools", () => {
  it("returns only requested tools in request order", () => {
    expect(createApprovedCodingTools(process.cwd(), ["read", "grep"]).map((tool) => tool.name))
      .toEqual(["read", "grep"]);
  });

  it("does not enable bash implicitly", () => {
    expect(createApprovedCodingTools(process.cwd(), ["read"]).map((tool) => tool.name))
      .toEqual(["read"]);
  });
});
