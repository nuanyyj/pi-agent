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
  // clean slate for this suite


});

afterAll(async () => {
  await db?.close();
});

// ── helpers ────────────────────────────────────────────────────────────

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

// ── tests ──────────────────────────────────────────────────────────────

describe("session broker reads", () => {
  it("create + openSessionById round-trip", async () => {
    const orgId = org();
    const created = await broker.createSession({
      organizationId: orgId,
      workspaceRoot: "/workspace/a",
    });
    expect(created.version).toBe(0);
    expect(created.activeLeafId).toBeNull();
    expect(created.entries).toEqual([]);

    const opened = await broker.openSessionById(created.metadata.id, orgId);
    expect(opened.metadata.id).toBe(created.metadata.id);
    expect(opened.metadata.organizationId).toBe(orgId);
  });

  it("openSession by metadata round-trip", async () => {
    const orgId = org();
    const created = await broker.createSession({
      organizationId: orgId,
      workspaceRoot: "/workspace/b",
    });
    const opened = await broker.openSession(created.metadata);
    expect(opened.metadata.id).toBe(created.metadata.id);
    expect(opened.version).toBe(0);
  });

  it("listSessions filters by organization and workspaceRoot", async () => {
    const orgId = org();
    await broker.createSession({
      organizationId: orgId,
      workspaceRoot: "/ws/1",
    });
    await broker.createSession({
      organizationId: orgId,
      workspaceRoot: "/ws/2",
    });

    const all = await broker.listSessions({ organizationId: orgId });
    expect(all.length).toBe(2);

    const filtered = await broker.listSessions({
      organizationId: orgId,
      workspaceRoot: "/ws/1",
    });
    expect(filtered.length).toBe(1);
    expect(filtered[0]!.workspaceRoot).toBe("/ws/1");
  });

  it("appendAndAdvance + getEntries + getPathToRoot", async () => {
    const orgId = org();
    const created = await broker.createSession({
      organizationId: orgId,
      workspaceRoot: "/workspace/c",
    });

    const e1 = msg("e1", null, "first");
    const r1 = await broker.appendAndAdvance({
      sessionId: created.metadata.id,
      expectedVersion: 0,
      entry: e1,
    });
    expect(r1.ok).toBe(true);
    if (!r1.ok) throw new Error("unreachable");

    const e2 = msg("e2", "e1", "second");
    const r2 = await broker.appendAndAdvance({
      sessionId: created.metadata.id,
      expectedVersion: r1.value.version,
      entry: e2,
    });
    expect(r2.ok).toBe(true);
    if (!r2.ok) throw new Error("unreachable");

    const entries = await broker.getEntries(created.metadata.id);
    expect(entries.length).toBe(2);
    expect(entries[0]!.id).toBe("e1");
    expect(entries[1]!.id).toBe("e2");

    const path = await broker.getPathToRoot(created.metadata.id, "e2");
    expect(path.map((e) => e.id)).toEqual(["e1", "e2"]);
  });

  it("getEntry returns single entry by id", async () => {
    const orgId = org();
    const created = await broker.createSession({
      organizationId: orgId,
      workspaceRoot: "/workspace/d",
    });
    const entry = msg("single", null, "hello");
    await broker.appendAndAdvance({
      sessionId: created.metadata.id,
      expectedVersion: 0,
      entry,
    });

    const loaded = await broker.getEntry(created.metadata.id, "single");
    expect(loaded?.id).toBe("single");

    const missing = await broker.getEntry(created.metadata.id, "nope");
    expect(missing).toBeUndefined();
  });

  it("getLabel resolves latest label for a target", async () => {
    const orgId = org();
    const created = await broker.createSession({
      organizationId: orgId,
      workspaceRoot: "/workspace/e",
    });

    const entry = msg("target", null, "content");
    await broker.appendAndAdvance({
      sessionId: created.metadata.id,
      expectedVersion: 0,
      entry,
    });

    const label1: import("@earendil-works/pi-agent-core").LabelEntry = {
      type: "label",
      id: "lbl-1",
      parentId: "target",
      timestamp: new Date().toISOString(),
      targetId: "target",
      label: "first",
    };
    const label2: import("@earendil-works/pi-agent-core").LabelEntry = {
      type: "label",
      id: "lbl-2",
      parentId: "target",
      timestamp: new Date().toISOString(),
      targetId: "target",
      label: "updated",
    };

    await broker.appendAndAdvance({
      sessionId: created.metadata.id,
      expectedVersion: 1,
      entry: label1,
    });
    await broker.appendAndAdvance({
      sessionId: created.metadata.id,
      expectedVersion: 2,
      entry: label2,
    });

    expect(await broker.getLabel(created.metadata.id, "target")).toBe("updated");
    expect(
      await broker.getLabel(created.metadata.id, "nonexistent"),
    ).toBeUndefined();
  });

  it("forkSession copies the selected branch path", async () => {
    const orgId = org();
    const created = await broker.createSession({
      organizationId: orgId,
      workspaceRoot: "/workspace/f",
    });

    const e1 = msg("fe1", null, "first");
    const e2 = msg("fe2", "fe1", "second");
    const e3 = msg("fe3", "fe2", "third");

    let v = 0;
    for (const entry of [e1, e2, e3]) {
      const r = await broker.appendAndAdvance({
        sessionId: created.metadata.id,
        expectedVersion: v,
        entry,
      });
      if (!r.ok) throw new Error("unexpected conflict");
      v = r.value.version;
    }

    const forked = await broker.forkSession(created.metadata, {
      organizationId: orgId,
      workspaceRoot: "/workspace/f",
      entryId: "fe2",
      position: "at",
    });

    expect(forked.metadata.id).not.toBe(created.metadata.id);
    expect(forked.entries.length).toBe(2);
    expect(forked.entries.map((e) => e.id)).toEqual(["fe1", "fe2"]);
    expect(forked.version).toBe(2);
    expect(forked.activeLeafId).toBe("fe2");
  });

  it("deleteSession marks session as deleted", async () => {
    const orgId = org();
    const created = await broker.createSession({
      organizationId: orgId,
      workspaceRoot: "/workspace/g",
    });
    await broker.deleteSession(created.metadata.id, orgId);
    await expect(
      broker.openSessionById(created.metadata.id, orgId),
    ).rejects.toThrow(/deleted/i);
  });
});

