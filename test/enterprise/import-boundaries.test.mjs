import assert from "node:assert/strict";
import test from "node:test";
import { findForbiddenImports } from "../../scripts/check-enterprise-imports.mjs";

test("rejects enterprise imports of local runtime modules", () => {
  const failures = findForbiddenImports("platform/modules/runs/api/route.ts", `
    import { startRpcSession } from "@/lib/rpc-manager";
  `);

  assert.deepEqual(failures, ["@/lib/rpc-manager"]);
});

test("allows enterprise protocol imports", () => {
  assert.deepEqual(
    findForbiddenImports(
      "packages/enterprise-worker/src/main.ts",
      `import { parseRunEnvelope } from "@pi-web/enterprise-protocol";`,
    ),
    [],
  );
});
