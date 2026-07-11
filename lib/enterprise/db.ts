/**
 * Shared enterprise database connection for API routes.
 *
 * Uses a singleton pg.Pool on globalThis to survive Next.js hot-reload
 * in development. The pool is lazily initialized on first use.
 */
import { createEnterpriseDatabase, type EnterpriseDatabase } from "@pi-web/enterprise-session-broker";

declare global {
  var __piEnterpriseDb: EnterpriseDatabase | undefined;
  var __piEnterpriseDbInitializing: Promise<EnterpriseDatabase> | undefined;
}

const PG_URL = process.env.PI_POSTGRES_URL;

/**
 * Get or create the shared enterprise database connection.
 * Returns undefined when PI_POSTGRES_URL is not configured (enterprise disabled).
 */
export async function getEnterpriseDb(): Promise<EnterpriseDatabase | undefined> {
  if (!PG_URL) return undefined;

  if (globalThis.__piEnterpriseDb) return globalThis.__piEnterpriseDb;

  // Prevent concurrent initialization
  if (globalThis.__piEnterpriseDbInitializing) {
    return globalThis.__piEnterpriseDbInitializing;
  }

  globalThis.__piEnterpriseDbInitializing = createEnterpriseDatabase(PG_URL)
    .then((db) => {
      globalThis.__piEnterpriseDb = db;
      globalThis.__piEnterpriseDbInitializing = undefined;
      return db;
    })
    .catch((err) => {
      globalThis.__piEnterpriseDbInitializing = undefined;
      throw err;
    });

  return globalThis.__piEnterpriseDbInitializing;
}

/**
 * Check if enterprise mode is enabled (PI_POSTGRES_URL is set).
 */
export function isEnterpriseEnabled(): boolean {
  return Boolean(PG_URL);
}
