import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const PI_PACKAGES = [
  "@earendil-works/pi-agent-core",
  "@earendil-works/pi-ai",
  "@earendil-works/pi-coding-agent",
];

export function validateRuntimeVersions(manifests) {
  const found = [];
  const errors = [];
  for (const [manifestName, manifest] of Object.entries(manifests)) {
    for (const packageName of PI_PACKAGES) {
      const version = manifest.dependencies?.[packageName];
      if (version === undefined) continue;
      if (!/^\d+\.\d+\.\d+$/.test(version)) {
        errors.push(`${manifestName}:${packageName} must use an exact version, received ${version}`);
      } else {
        found.push({ manifestName, packageName, version });
      }
    }
  }
  const versions = new Set(found.map((item) => item.version));
  if (versions.size > 1) {
    errors.push(`Pi packages must use one lockstep version: ${[...versions].sort().join(", ")}`);
  }
  return errors;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function main(rootDir) {
  const errors = validateRuntimeVersions({
    web: readJson(resolve(rootDir, "package.json")),
    worker: readJson(resolve(rootDir, "packages/enterprise-worker/package.json")),
  });
  if (errors.length > 0) {
    for (const error of errors) console.error(error);
    process.exitCode = 1;
  }
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(resolve(dirname(scriptPath), ".."));
}
