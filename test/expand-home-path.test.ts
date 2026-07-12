import { describe, expect, it } from "vitest";
import { expandHomePath } from "../lib/expand-home-path";

describe("expandHomePath", () => {
  it("expands Unix home paths", () => {
    expect(expandHomePath("~", "/home/pi")).toBe("/home/pi");
    expect(expandHomePath("~/projects/app", "/home/pi")).toBe("/home/pi/projects/app");
  });

  it("expands Windows home paths with Windows separators", () => {
    expect(expandHomePath("~/projects/app", "C:\\Users\\Admin"))
      .toBe("C:\\Users\\Admin\\projects\\app");
  });

  it("leaves the input unchanged when home is unavailable", () => {
    expect(expandHomePath("~/projects/app", "")).toBe("~/projects/app");
    expect(expandHomePath("/srv/project", "/home/pi")).toBe("/srv/project");
  });
});
