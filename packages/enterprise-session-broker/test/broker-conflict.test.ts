import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSessionBroker } from "../src/broker";
import { createEnterpriseDatabase, type EnterpriseDatabase } from "../src/db";
import type { SessionBroker } from "../src/types";

const PG_URL =
  process.env.PI_POSTGRES_URL ??
  "postgres://pi_enterprise:replace-for-local-development@127.0.0.1:5432/pi_enterprise";

let db: EnterpriseDatabase;
let broker: SessionBroker;

beforeAll(async () => {
  db = await createEnterpriseDatabase(PG_URL);
  broker = createSessionBroker(db);


});

afterAll(async () => {
  await db?.close();
});

function org() {
  return `org-${randomUUID().slice(0, 8)}`;
}

function msg(
  id: string,
  parentId: string | null,
  content: string,
): Extract<
  import("@earendil-works/pi-agent-core").SessionTreeEntry,
  { type: "message" }
> {
  return {
    type: "message",
    id,
    parentId,
    timestamp: new Date().toISOString(),
    message: { role: "user", content, timestamp: Date.now() },
  };
}

describe("session broker conflicts", () => {
  it("rejects stale appendAndAdvance without partial persistence", async () => {
    const orgId = org();
    const created = await broker.createSession({
      organizationId: orgId,
      workspaceRoot: "/workspace",
    });

    const ok = await broker.appendAndAdvance({
      sessionId: created.metadata.id,
      expectedVersion: 0,
      entry: msg("ok-1", null, "first"),
    });
    expect(ok.ok).toBe(true);

    const conflict = await broker.appendAndAdvance({
      sessionId: created.metadata.id,
      expectedVersion: 0, // stale
      entry: msg("stale-1", null, "second"),
    });
    expect(conflict.ok).toBe(false);
    if (conflict.ok) throw new Error("unreachable");
    expect(conflict.currentVersion).toBe(1);

    // verify only the first write persisted
    const entries = await broker.getEntries(created.metadata.id);
    expect(entries.length).toBe(1);
    expect(entries[0]!.id).toBe("ok-1");
  });

  it("rejects stale moveLeaf", async () => {
    const orgId = org();
    const created = await broker.createSession({
      organizationId: orgId,
      workspaceRoot: "/workspace",
    });

    const entry = msg("ml-1", null, "content");
    const r = await broker.appendAndAdvance({
      sessionId: created.metadata.id,
      expectedVersion: 0,
      entry,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("unreachable");

    const conflict = await broker.moveLeaf({
      sessionId: created.metadata.id,
      expectedVersion: 0, // stale
      targetId: "ml-1",
    });
    expect(conflict.ok).toBe(false);
    if (conflict.ok) throw new Error("unreachable");
    expect(conflict.currentVersion).toBe(1);
  });

  it("concurrent appendAndAdvance: only one writer wins per version", async () => {
    const orgId = org();
    const created = await broker.createSession({
      organizationId: orgId,
      workspaceRoot: "/workspace",
    });

    // Both claim version 0
    const [r1, r2] = await Promise.all([
      broker.appendAndAdvance({
        sessionId: created.metadata.id,
        expectedVersion: 0,
        entry: msg("race-a", null, "A"),
      }),
      broker.appendAndAdvance({
        sessionId: created.metadata.id,
        expectedVersion: 0,
        entry: msg("race-b", null, "B"),
      }),
    ]);

    const results = [r1, r2];
    const winners = results.filter((r) => r.ok);
    const losers = results.filter((r) => !r.ok);

    expect(winners.length).toBe(1);
    expect(losers.length).toBe(1);

    // Verify exactly one entry persisted
    const entries = await broker.getEntries(created.metadata.id);
    expect(entries.length).toBe(1);
    expect(["race-a", "race-b"]).toContain(entries[0]!.id);
  });

  it("appendAndAdvance rejects wrong parent id", async () => {
    const orgId = org();
    const created = await broker.createSession({
      organizationId: orgId,
      workspaceRoot: "/workspace",
    });

    await expect(
      broker.appendAndAdvance({
        sessionId: created.metadata.id,
        expectedVersion: 0,
        entry: msg("bad-parent", "nonexistent", "content"),
      }),
    ).rejects.toThrow(/not found/i);
  });

  it("appendAndAdvance rejects root append on non-empty session", async () => {
    const orgId = org();
    const created = await broker.createSession({
      organizationId: orgId,
      workspaceRoot: "/workspace",
    });

    await broker.appendAndAdvance({
      sessionId: created.metadata.id,
      expectedVersion: 0,
      entry: msg("first", null, "first"),
    });

    await expect(
      broker.appendAndAdvance({
        sessionId: created.metadata.id,
        expectedVersion: 1,
        entry: msg("second-root", null, "second"),
      }),
    ).rejects.toThrow(/root append/i);
  });

  it("moveLeaf rejects nonexistent target entry", async () => {
    const orgId = org();
    const created = await broker.createSession({
      organizationId: orgId,
      workspaceRoot: "/workspace",
    });

    await expect(
      broker.moveLeaf({
        sessionId: created.metadata.id,
        expectedVersion: 0,
        targetId: "ghost",
      }),
    ).rejects.toThrow(/not found/i);
  });
});
