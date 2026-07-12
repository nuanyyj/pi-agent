import { describe, expect, it } from "vitest";
import type { EnterpriseDatabase } from "@pi-web/enterprise-session-broker";
import { createPgEventWriter } from "../src/run-executor";

describe("createPgEventWriter", () => {
  it("serializes event inserts and notifies listeners before flush resolves", async () => {
    const calls: Array<{ sql: string; params?: readonly unknown[] }> = [];
    const db: EnterpriseDatabase = {
      async query(sql, params) {
        calls.push({ sql, params });
        return { rows: [] };
      },
      async transaction() {
        throw new Error("not used");
      },
      async withOrganization() {
        throw new Error("not used");
      },
      async close() {},
    };
    const writer = createPgEventWriter(db, "run-1");

    writer.writeEvent("message", { value: 1 });
    writer.writeEvent("tool", { value: 2 });
    await writer.flush();

    const inserts = calls.filter((call) => call.sql.includes("insert into enterprise_run_events"));
    const notifications = calls.filter((call) => call.sql.includes("pg_notify"));
    expect(inserts.map((call) => call.params?.[1])).toEqual([1, 2]);
    expect(notifications.map((call) => call.params)).toEqual([
      ["run-1", "1"],
      ["run-1", "2"],
    ]);
  });
});
