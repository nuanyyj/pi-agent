import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Session, SessionError } from "@earendil-works/pi-agent-core"; import type { UserMessage } from "@earendil-works/pi-ai";
import { createSessionBroker } from "../src/broker";
import { createEnterpriseDatabase, type EnterpriseDatabase } from "../src/db";
import { PostgresSessionRepo } from "../src/repo";
import { BrokeredSessionStorage } from "../src/storage";
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

function userMsg(content: string): UserMessage {
  return { role: "user", content, timestamp: Date.now() };
}

describe("PostgresSessionRepo", () => {
  it("create + open + list + delete round-trip", async () => {
    const orgId = org();
    const repo = new PostgresSessionRepo(broker);

    const session = await repo.create({
      organizationId: orgId,
      workspaceRoot: "/ws/repo",
    });
    const meta = await session.getMetadata();
    expect(meta.organizationId).toBe(orgId);

    const reopened = await repo.open(meta);
    expect((await reopened.getMetadata()).id).toBe(meta.id);

    const listed = await repo.list({ organizationId: orgId });
    expect(listed.map((m) => m.id)).toContain(meta.id);

    await repo.delete(meta);
    await expect(repo.open(meta)).rejects.toThrow(/deleted/i);
  });

  it("fork creates a new session with copied entries", async () => {
    const orgId = org();
    const repo = new PostgresSessionRepo(broker);

    const source = await repo.create({
      organizationId: orgId,
      workspaceRoot: "/ws/fork",
    });

    await source.appendMessage(userMsg("hello"));
    await source.appendMessage(userMsg("hi there"));
    await source.appendMessage(userMsg("bye"));

    const sourceMeta = await source.getMetadata();
    const sourceEntries = await source.getEntries();
    expect(sourceEntries.length).toBe(3);

    const forked = await repo.fork(sourceMeta, {
      organizationId: orgId,
      workspaceRoot: "/ws/fork",
      entryId: sourceEntries[1]!.id,
      position: "at",
    });

    const forkedEntries = await forked.getEntries();
    expect(forkedEntries.length).toBe(2);
    expect(forkedEntries.map((e) => e.id)).toEqual(
      sourceEntries.slice(0, 2).map((e) => e.id),
    );
  });
});

describe("BrokeredSessionStorage", () => {
  it("implements the full SessionStorage read contract", async () => {
    const orgId = org();
    const snapshot = await broker.createSession({
      organizationId: orgId,
      workspaceRoot: "/ws/storage",
    });

    const storage = new BrokeredSessionStorage({
      broker,
      metadata: snapshot.metadata,
      initialVersion: snapshot.version,
      initialLeafId: snapshot.activeLeafId,
    });

    const meta = await storage.getMetadata();
    expect(meta.organizationId).toBe(orgId);
    expect(meta.id).toBe(snapshot.metadata.id);

    expect(await storage.getLeafId()).toBeNull();
    expect(await storage.getEntries()).toEqual([]);

    const entryId = await storage.createEntryId();
    expect(typeof entryId).toBe("string");
    expect(entryId.length).toBeGreaterThan(0);

    expect(await storage.getEntry("nope")).toBeUndefined();
    expect(await storage.getLabel("nope")).toBeUndefined();
    expect(await storage.getPathToRoot(null)).toEqual([]);
  });

  it("appendEntry and setLeafId track version correctly", async () => {
    const orgId = org();
    const snapshot = await broker.createSession({
      organizationId: orgId,
      workspaceRoot: "/ws/mutate",
    });

    const storage = new BrokeredSessionStorage({
      broker,
      metadata: snapshot.metadata,
      initialVersion: snapshot.version,
      initialLeafId: snapshot.activeLeafId,
    });

    await storage.appendEntry({
      type: "message",
      id: "m1",
      parentId: null,
      timestamp: new Date().toISOString(),
      message: userMsg("hello"),
    });

    expect(await storage.getLeafId()).toBe("m1");
    const entries = await storage.getEntries();
    expect(entries.length).toBe(1);
    expect(entries[0]!.id).toBe("m1");

    await storage.appendEntry({
      type: "message",
      id: "m2",
      parentId: "m1",
      timestamp: new Date().toISOString(),
      message: userMsg("hi"),
    });

    expect(await storage.getLeafId()).toBe("m2");

    const path = await storage.getPathToRoot("m2");
    expect(path.map((e) => e.id)).toEqual(["m1", "m2"]);

    const messages = await storage.findEntries("message");
    expect(messages.length).toBe(2);
  });

  it("setLeafId creates a leaf entry and updates the leaf", async () => {
    const orgId = org();
    const snapshot = await broker.createSession({
      organizationId: orgId,
      workspaceRoot: "/ws/leaf",
    });

    const storage = new BrokeredSessionStorage({
      broker,
      metadata: snapshot.metadata,
      initialVersion: snapshot.version,
      initialLeafId: snapshot.activeLeafId,
    });

    await storage.appendEntry({
      type: "message",
      id: "lf1",
      parentId: null,
      timestamp: new Date().toISOString(),
      message: userMsg("first"),
    });
    await storage.appendEntry({
      type: "message",
      id: "lf2",
      parentId: "lf1",
      timestamp: new Date().toISOString(),
      message: userMsg("second"),
    });

    expect(await storage.getLeafId()).toBe("lf2");

    await storage.setLeafId("lf1");
    expect(await storage.getLeafId()).toBe("lf1");

    await storage.setLeafId(null);
    expect(await storage.getLeafId()).toBeNull();
  });

  it("throws SessionError on version conflict", async () => {
    const orgId = org();
    const snapshot = await broker.createSession({
      organizationId: orgId,
      workspaceRoot: "/ws/conflict",
    });

    const storageA = new BrokeredSessionStorage({
      broker,
      metadata: snapshot.metadata,
      initialVersion: snapshot.version,
      initialLeafId: snapshot.activeLeafId,
    });
    const storageB = new BrokeredSessionStorage({
      broker,
      metadata: snapshot.metadata,
      initialVersion: snapshot.version,
      initialLeafId: snapshot.activeLeafId,
    });

    await storageA.appendEntry({
      type: "message",
      id: "c1",
      parentId: null,
      timestamp: new Date().toISOString(),
      message: userMsg("from A"),
    });

    await expect(
      storageB.appendEntry({
        type: "message",
        id: "c2",
        parentId: null,
        timestamp: new Date().toISOString(),
        message: userMsg("from B"),
      }),
    ).rejects.toThrow(SessionError);
  });

  it("findEntries by custom type", async () => {
    const orgId = org();
    const snapshot = await broker.createSession({
      organizationId: orgId,
      workspaceRoot: "/ws/find",
    });

    const storage = new BrokeredSessionStorage({
      broker,
      metadata: snapshot.metadata,
      initialVersion: snapshot.version,
      initialLeafId: snapshot.activeLeafId,
    });

    await storage.appendEntry({
      type: "message",
      id: "fe-m1",
      parentId: null,
      timestamp: new Date().toISOString(),
      message: userMsg("msg"),
    });
    await storage.appendEntry({
      type: "custom",
      id: "fe-c1",
      parentId: "fe-m1",
      timestamp: new Date().toISOString(),
      customType: "test_event",
      data: { key: "value" },
    });
    await storage.appendEntry({
      type: "message",
      id: "fe-m2",
      parentId: "fe-c1",
      timestamp: new Date().toISOString(),
      message: userMsg("reply"),
    });

    const messages = await storage.findEntries("message");
    expect(messages.length).toBe(2);

    const customs = await storage.findEntries("custom");
    expect(customs.length).toBe(1);
    if (customs[0] && customs[0].type === "custom") {
      expect(customs[0].customType).toBe("test_event");
    }
  });
});

describe("Session through broker (full integration)", () => {
  it("Session wrapper works end-to-end with appendMessage and buildContext", async () => {
    const orgId = org();
    const repo = new PostgresSessionRepo(broker);
    const session = await repo.create({
      organizationId: orgId,
      workspaceRoot: "/ws/e2e",
    });

    await session.appendMessage(userMsg("What is TypeScript?"));
    await session.appendMessage(userMsg("Thanks!"));

    const entries = await session.getEntries();
    expect(entries.length).toBe(2);

    const context = await session.buildContext();
    expect(context.messages.length).toBe(2);

    const name = await session.getSessionName();
    expect(name).toBeUndefined();
  });

  it("restart: new broker instance sees durable state", async () => {
    const orgId = org();
    const snapshot = await broker.createSession({
      organizationId: orgId,
      workspaceRoot: "/ws/restart",
    });

    await broker.appendAndAdvance({
      sessionId: snapshot.metadata.id,
      expectedVersion: 0,
      entry: {
        type: "message",
        id: "rst-1",
        parentId: null,
        timestamp: new Date().toISOString(),
        message: userMsg("persistent"),
      },
    });

    const broker2 = createSessionBroker(db);
    const reopened = await broker2.openSessionById(snapshot.metadata.id);
    expect(reopened.version).toBe(1);
    expect(reopened.activeLeafId).toBe("rst-1");

    const storage = new BrokeredSessionStorage({
      broker: broker2,
      metadata: reopened.metadata,
      initialVersion: reopened.version,
      initialLeafId: reopened.activeLeafId,
    });

    const entry = await storage.getEntry("rst-1");
    expect(entry?.id).toBe("rst-1");

    await storage.appendEntry({
      type: "message",
      id: "rst-2",
      parentId: "rst-1",
      timestamp: new Date().toISOString(),
      message: userMsg("still here"),
    });

    const all = await storage.getEntries();
    expect(all.length).toBe(2);
  });
});
