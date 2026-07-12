import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveEnterpriseWorkspaceRoot } from "../../lib/enterprise/workspace-policy";

const createdDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(createdDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })
  ));
});

async function createWorkspaceTree() {
  const root = await mkdtemp(join(tmpdir(), "pi-enterprise-workspace-"));
  createdDirectories.push(root);
  const allowed = join(root, "allowed");
  const child = join(allowed, "project");
  const outside = join(root, "outside");
  await mkdir(child, { recursive: true });
  await mkdir(outside, { recursive: true });
  return { allowed, child, outside };
}

describe("resolveEnterpriseWorkspaceRoot", () => {
  it("allows an existing directory under a configured root", async () => {
    const { allowed, child } = await createWorkspaceTree();

    await expect(resolveEnterpriseWorkspaceRoot(child, [allowed])).resolves.toBe(child);
  });

  it("rejects paths outside configured roots", async () => {
    const { allowed, outside } = await createWorkspaceTree();

    await expect(resolveEnterpriseWorkspaceRoot(outside, [allowed]))
      .rejects.toThrow("Workspace root is outside the configured enterprise roots");
  });

  it("rejects a missing workspace directory", async () => {
    const { allowed } = await createWorkspaceTree();

    await expect(resolveEnterpriseWorkspaceRoot(join(allowed, "missing"), [allowed]))
      .rejects.toThrow("Workspace root does not exist or is not a directory");
  });
});
