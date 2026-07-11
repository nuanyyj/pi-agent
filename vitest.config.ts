import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@pi-web/enterprise-protocol": resolve("packages/enterprise-protocol/src/index.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts", "packages/*/test/**/*.test.ts"],
  },
});
