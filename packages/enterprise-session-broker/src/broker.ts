import { randomUUID } from "node:crypto";
import { SessionError, uuidv7, type SessionTreeEntry } from "@earendil-works/pi-agent-core";
import type { EnterpriseDatabase, EnterpriseTransaction } from "./db.js";
import type {
  AppendAndAdvanceInput,
  BrokerConflict,
  BrokerResult,
  BrokerSessionSnapshot,
  CreateEnterpriseSessionOptions,
  EnterpriseSessionMetadata,
  ListEnterpriseSessionOptions,
  MoveLeafInput,
  SessionBroker,
} from "./types.js";

type SessionRow = {
  id: string;
  organization_id: string;
  workspace_root: string;
  scope: Record<string, unknown>;
  metadata: Record<string, unknown>;
  parent_session_id: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  version: number;
  active_leaf_id: string | null;
};

type EntryRow = {
  entry: SessionTreeEntry;
};

function toMetadata(row: SessionRow): EnterpriseSessionMetadata {
  return {
    id: row.id,
    createdAt: row.created_at,
    organizationId: row.organization_id,
    workspaceRoot: row.workspace_root,
    parentSessionId: row.parent_session_id ?? undefined,
    scope: row.scope,
    metadata: row.metadata,
  };
}

function toSnapshot(row: SessionRow, entries: SessionTreeEntry[]): BrokerSessionSnapshot {
  return {
    metadata: toMetadata(row),
    version: Number(row.version),
    activeLeafId: row.active_leaf_id,
    entries,
  };
}

function conflict(row: SessionRow): BrokerConflict {
  return {
    ok: false,
    currentVersion: Number(row.version),
    currentLeafId: row.active_leaf_id,
  };
}

function cloneEntry(entry: SessionTreeEntry): SessionTreeEntry {
  return JSON.parse(JSON.stringify(entry)) as SessionTreeEntry;
}

async function loadSessionRow(tx: EnterpriseTransaction, sessionId: string): Promise<SessionRow> {
  const result = await tx.query<SessionRow>(
    `select id, organization_id, workspace_root, scope, metadata, parent_session_id, created_at, updated_at, deleted_at, version, active_leaf_id
     from enterprise_sessions
     where id = $1
     for update`,
    [sessionId],
  );
  const row = result.rows[0];
  if (!row) throw new SessionError("not_found", `Session not found: ${sessionId}`);
  if (row.deleted_at) throw new SessionError("invalid_session", `Session deleted: ${sessionId}`);
  row.version = Number(row.version);
  return row;
}

async function loadSessionRowByMetadata(
  tx: EnterpriseTransaction,
  metadata: EnterpriseSessionMetadata,
): Promise<SessionRow> {
  const row = await loadSessionRow(tx, metadata.id);
  if (row.organization_id !== metadata.organizationId) {
    throw new SessionError(
      "invalid_session",
      `Session ${metadata.id} does not belong to organization ${metadata.organizationId}`,
    );
  }
  return row;
}

async function loadEntries(tx: EnterpriseTransaction, sessionId: string): Promise<SessionTreeEntry[]> {
  const result = await tx.query<EntryRow>(
    `select entry
     from enterprise_session_entries
     where session_id = $1
     order by version asc`,
    [sessionId],
  );
  return result.rows.map((row) => cloneEntry(row.entry));
}

async function loadEntry(
  tx: EnterpriseTransaction,
  sessionId: string,
  entryId: string,
): Promise<SessionTreeEntry | undefined> {
  const result = await tx.query<EntryRow>(
    `select entry
     from enterprise_session_entries
     where session_id = $1 and entry_id = $2`,
    [sessionId, entryId],
  );
  return result.rows[0] ? cloneEntry(result.rows[0]!.entry) : undefined;
}

async function loadLabel(
  tx: EnterpriseTransaction,
  sessionId: string,
  entryId: string,
): Promise<string | undefined> {
  const result = await tx.query<EntryRow>(
    `select entry
     from enterprise_session_entries
     where session_id = $1 and entry_type = 'label'
     order by version asc`,
    [sessionId],
  );
  let label: string | undefined;
  for (const row of result.rows) {
    const entry = row.entry;
    if (entry.type !== "label" || entry.targetId !== entryId) continue;
    label = entry.label?.trim() || undefined;
  }
  return label;
}

async function loadPathToRoot(
  tx: EnterpriseTransaction,
  sessionId: string,
  leafId: string | null,
): Promise<SessionTreeEntry[]> {
  if (leafId === null) return [];
  const entries = await loadEntries(tx, sessionId);
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const current = byId.get(leafId);
  if (!current) throw new SessionError("not_found", `Entry ${leafId} not found`);
  const path: SessionTreeEntry[] = [];
  let cursor: SessionTreeEntry | undefined = current;
  while (cursor) {
    path.unshift(cloneEntry(cursor));
    if (!cursor.parentId) break;
    const parent = byId.get(cursor.parentId);
    if (!parent) throw new SessionError("invalid_session", `Entry ${cursor.parentId} not found`);
    cursor = parent;
  }
  return path;
}

function currentLeafFor(entry: SessionTreeEntry): string | null {
  return entry.type === "leaf" ? entry.targetId : entry.id;
}

async function insertEntry(
  tx: EnterpriseTransaction,
  sessionId: string,
  version: number,
  entry: SessionTreeEntry,
): Promise<void> {
  await tx.query(
    `insert into enterprise_session_entries
     (session_id, version, entry_id, parent_id, entry_type, entry, recorded_at)
     values ($1, $2, $3, $4, $5, $6, now())`,
    [sessionId, version, entry.id, entry.parentId ?? null, entry.type, entry],
  );
}

export function createSessionBroker(db: EnterpriseDatabase): SessionBroker {
  async function snapshotFor(tx: EnterpriseTransaction, metadata: EnterpriseSessionMetadata): Promise<BrokerSessionSnapshot> {
    const row = await loadSessionRowByMetadata(tx, metadata);
    return toSnapshot(row, await loadEntries(tx, row.id));
  }

  return {
    async createSession(options: CreateEnterpriseSessionOptions): Promise<BrokerSessionSnapshot> {
      const id = options.id ?? uuidv7();
      const createdAt = new Date().toISOString();
      await db.transaction(async (tx) => {
        await tx.query(
          `insert into enterprise_sessions
           (id, organization_id, workspace_root, scope, metadata, parent_session_id, created_at, updated_at, deleted_at, version, active_leaf_id)
           values ($1, $2, $3, $4, $5, $6, $7, $7, null, 0, null)`,
          [
            id,
            options.organizationId,
            options.workspaceRoot,
            options.scope ?? {},
            options.metadata ?? {},
            options.parentSessionId ?? null,
            createdAt,
          ],
        );
        return undefined;
      });
      return {
        metadata: {
          id,
          createdAt,
          organizationId: options.organizationId,
          workspaceRoot: options.workspaceRoot,
          parentSessionId: options.parentSessionId,
          scope: options.scope ?? {},
          metadata: options.metadata ?? {},
        },
        version: 0,
        activeLeafId: null,
        entries: [],
      };
    },
    async openSessionById(sessionId: string): Promise<BrokerSessionSnapshot> {
      return db.transaction(async (tx) => {
        const row = await loadSessionRow(tx, sessionId);
        return toSnapshot(row, await loadEntries(tx, row.id));
      });
    },
    async openSession(metadata: EnterpriseSessionMetadata): Promise<BrokerSessionSnapshot> {
      return db.transaction(async (tx) => snapshotFor(tx, metadata));
    },
    async listSessions(options: ListEnterpriseSessionOptions): Promise<EnterpriseSessionMetadata[]> {
      return db.transaction(async (tx) => {
        let sql = `
          select id, organization_id, workspace_root, scope, metadata, parent_session_id, created_at, updated_at, deleted_at, version, active_leaf_id
          from enterprise_sessions
          where organization_id = $1 and deleted_at is null
        `;
        const params: unknown[] = [options.organizationId];
        if (options.workspaceRoot) {
          sql += ` and workspace_root = $2`;
          params.push(options.workspaceRoot);
        }
        sql += ` order by created_at desc`;
        const result = await tx.query<SessionRow>(sql, params);
        return result.rows.map(toMetadata);
      });
    },
    async getEntry(sessionId: string, entryId: string): Promise<SessionTreeEntry | undefined> {
      return db.transaction((tx) => loadEntry(tx, sessionId, entryId));
    },
    async getEntries(sessionId: string): Promise<SessionTreeEntry[]> {
      return db.transaction((tx) => loadEntries(tx, sessionId));
    },
    async getPathToRoot(sessionId: string, leafId: string | null): Promise<SessionTreeEntry[]> {
      return db.transaction((tx) => loadPathToRoot(tx, sessionId, leafId));
    },
    async getLabel(sessionId: string, entryId: string): Promise<string | undefined> {
      return db.transaction((tx) => loadLabel(tx, sessionId, entryId));
    },
    async appendAndAdvance(input: AppendAndAdvanceInput): Promise<BrokerResult<{ version: number; entryId: string }>> {
      return db.transaction(async (tx) => {
        const row = await loadSessionRow(tx, input.sessionId);
        if (row.version !== input.expectedVersion) return conflict(row);
        if (input.entry.parentId !== null && input.entry.parentId !== undefined) {
          const parent = await loadEntry(tx, input.sessionId, input.entry.parentId);
          if (!parent) throw new SessionError("not_found", `Entry ${input.entry.parentId} not found`);
        } else if (row.active_leaf_id !== null && input.entry.parentId === null) {
          throw new SessionError("invalid_session", "Root append is only allowed on an empty session");
        }
        const nextVersion = row.version + 1;
        const entry = cloneEntry(input.entry);
        await insertEntry(tx, input.sessionId, nextVersion, entry);
        await tx.query(
          `update enterprise_sessions
           set version = $2, active_leaf_id = $3, updated_at = now()
           where id = $1`,
          [input.sessionId, nextVersion, currentLeafFor(entry)],
        );
        return { ok: true, value: { version: nextVersion, entryId: entry.id } };
      });
    },
    async moveLeaf(input: MoveLeafInput): Promise<BrokerResult<{ version: number; leafId: string | null }>> {
      return db.transaction(async (tx) => {
        const row = await loadSessionRow(tx, input.sessionId);
        if (row.version !== input.expectedVersion) return conflict(row);
        if (input.targetId !== null) {
          const target = await loadEntry(tx, input.sessionId, input.targetId);
          if (!target) throw new SessionError("not_found", `Entry ${input.targetId} not found`);
        }
        const nextVersion = row.version + 1;
        const leafEntry: SessionTreeEntry = {
          type: "leaf",
          id: randomUUID(),
          parentId: row.active_leaf_id,
          timestamp: new Date().toISOString(),
          targetId: input.targetId,
        };
        await insertEntry(tx, input.sessionId, nextVersion, leafEntry);
        await tx.query(
          `update enterprise_sessions
           set version = $2, active_leaf_id = $3, updated_at = now()
           where id = $1`,
          [input.sessionId, nextVersion, input.targetId],
        );
        return { ok: true, value: { version: nextVersion, leafId: input.targetId } };
      });
    },
    async forkSession(
      sourceMetadata: EnterpriseSessionMetadata,
      options: CreateEnterpriseSessionOptions & { entryId?: string; position?: "before" | "at" },
    ): Promise<BrokerSessionSnapshot> {
      return db.transaction(async (tx) => {
        const sourceRow = await loadSessionRowByMetadata(tx, sourceMetadata);
        const sourceEntries = await loadEntries(tx, sourceRow.id);
        const sourceSession = toSnapshot(sourceRow, sourceEntries);
        const forkEntries =
          options.entryId === undefined
            ? sourceSession.entries
            : await loadPathToRoot(
                tx,
                sourceRow.id,
                options.position === "at"
                  ? options.entryId
                  : (await loadEntry(tx, sourceRow.id, options.entryId))?.parentId ?? null,
              );
        const destination = await this.createSession({
          organizationId: options.organizationId,
          workspaceRoot: options.workspaceRoot,
          id: options.id,
          parentSessionId: sourceSession.metadata.id,
          scope: options.scope ?? sourceSession.metadata.scope,
          metadata: options.metadata ?? sourceSession.metadata.metadata,
        });
        for (let i = 0; i < forkEntries.length; i += 1) {
          const entry = cloneEntry(forkEntries[i]!);
          await insertEntry(tx, destination.metadata.id, i + 1, entry);
        }
        await tx.query(
          `update enterprise_sessions
           set version = $2, active_leaf_id = $3, updated_at = now()
           where id = $1`,
          [destination.metadata.id, forkEntries.length, forkEntries.at(-1)?.id ?? null],
        );
        return {
          metadata: destination.metadata,
          version: forkEntries.length,
          activeLeafId: forkEntries.at(-1)?.id ?? null,
          entries: forkEntries.map(cloneEntry),
        };
      });
    },
    async deleteSession(sessionId: string): Promise<void> {
      await db.transaction(async (tx) => {
        await loadSessionRow(tx, sessionId);
        await tx.query(`update enterprise_sessions set deleted_at = now(), updated_at = now() where id = $1`, [sessionId]);
        return undefined;
      });
    },
  };
}
