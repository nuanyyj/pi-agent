import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("enterprise compose pins PostgreSQL and MinIO and does not expose default secrets", async () => {
  const compose = await readFile(new URL("../../compose.enterprise.yml", import.meta.url), "utf8");
  assert.match(compose, /postgres:17\.6-alpine/);
  assert.match(compose, /minio\/minio:RELEASE\.2025-04-22T22-12-26Z/);
  assert.match(compose, /minio\/mc:RELEASE\.2025-04-16T18-13-26Z/);
  assert.doesNotMatch(compose, /minioadmin/);
});
