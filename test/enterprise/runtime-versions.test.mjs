import assert from "node:assert/strict";
import test from "node:test";
import { validateRuntimeVersions } from "../../scripts/check-enterprise-runtime-versions.mjs";

test("accepts one exact Pi version", () => {
  assert.deepEqual(validateRuntimeVersions({
    web: { dependencies: { "@earendil-works/pi-ai": "0.80.6", "@earendil-works/pi-coding-agent": "0.80.6" } },
    worker: { dependencies: { "@earendil-works/pi-ai": "0.80.6", "@earendil-works/pi-agent-core": "0.80.6", "@earendil-works/pi-coding-agent": "0.80.6" } },
  }), []);
});

test("rejects ranges and mismatched versions", () => {
  const errors = validateRuntimeVersions({
    web: { dependencies: { "@earendil-works/pi-ai": "^0.80.6", "@earendil-works/pi-coding-agent": "0.80.6" } },
    worker: { dependencies: { "@earendil-works/pi-ai": "0.80.7", "@earendil-works/pi-agent-core": "0.80.6", "@earendil-works/pi-coding-agent": "0.80.6" } },
  });
  assert.equal(errors.length, 2);
});
