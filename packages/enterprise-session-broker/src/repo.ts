import {
  Session,
  type SessionRepo,
  type SessionTreeEntry,
} from "@earendil-works/pi-agent-core";
import {
  BrokeredSessionStorage,
  type BrokeredSessionStorageOptions,
} from "./storage.js";
import type {
  CreateEnterpriseSessionOptions,
  EnterpriseSessionMetadata,
  ListEnterpriseSessionOptions,
  SessionBroker,
} from "./types.js";

/**
 * SessionRepo adapter backed by the enterprise session broker.
 *
 * Creates, opens, lists, deletes, and forks enterprise sessions through
 * the broker's atomic mutation layer. Every Session returned is backed
 * by a BrokeredSessionStorage that routes writes through PostgreSQL.
 */
export class PostgresSessionRepo
  implements
    SessionRepo<
      EnterpriseSessionMetadata,
      CreateEnterpriseSessionOptions,
      ListEnterpriseSessionOptions
    >
{
  private readonly broker: SessionBroker;

  constructor(broker: SessionBroker) {
    this.broker = broker;
  }

  async create(
    options: CreateEnterpriseSessionOptions,
  ): Promise<Session<EnterpriseSessionMetadata>> {
    const snapshot = await this.broker.createSession(options);
    return new Session(this.storageFromSnapshot(snapshot));
  }

  async open(
    metadata: EnterpriseSessionMetadata,
  ): Promise<Session<EnterpriseSessionMetadata>> {
    const snapshot = await this.broker.openSession(metadata);
    return new Session(this.storageFromSnapshot(snapshot));
  }

  async list(
    options?: ListEnterpriseSessionOptions,
  ): Promise<EnterpriseSessionMetadata[]> {
    if (!options) return [];
    return this.broker.listSessions(options);
  }

  async delete(metadata: EnterpriseSessionMetadata): Promise<void> {
    await this.broker.deleteSession(metadata.id, metadata.organizationId);
  }

  async fork(
    source: EnterpriseSessionMetadata,
    options: {
      entryId?: string;
      position?: "before" | "at";
      id?: string;
      organizationId?: string;
      workspaceRoot?: string;
    },
  ): Promise<Session<EnterpriseSessionMetadata>> {
    const snapshot = await this.broker.forkSession(source, {
      organizationId: options.organizationId ?? source.organizationId,
      workspaceRoot: options.workspaceRoot ?? source.workspaceRoot,
      id: options.id,
      entryId: options.entryId,
      position: options.position,
    });
    return new Session(this.storageFromSnapshot(snapshot));
  }

  private storageFromSnapshot(
    snapshot: Awaited<ReturnType<SessionBroker["createSession"]>>,
  ): BrokeredSessionStorage {
    return new BrokeredSessionStorage({
      broker: this.broker,
      metadata: snapshot.metadata,
      initialVersion: snapshot.version,
      initialLeafId: snapshot.activeLeafId,
    });
  }
}

