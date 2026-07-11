#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { preflightRun } from "./preflight.js";
async function main() {
    const envelopePath = process.env.PI_RUN_ENVELOPE_PATH;
    if (!envelopePath)
        throw new Error("PI_RUN_ENVELOPE_PATH is required");
    const input = JSON.parse(await readFile(envelopePath, "utf8"));
    process.stdout.write(`${JSON.stringify(preflightRun(input))}\n`);
}
main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
});
//# sourceMappingURL=main.js.map