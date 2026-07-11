/**
 * The BrokeredSessionStorage is the run-scoped session adapter that
 * AgentHarness uses. It tracks the current expected version and routes
 * all mutations through the broker's atomic compare-and-set path.
 *
 * This module re-exports it from storage.ts for spec alignment.
 */
export { BrokeredSessionStorage, } from "./storage.js";
//# sourceMappingURL=proxy.js.map