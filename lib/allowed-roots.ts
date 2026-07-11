// In-memory roots that should be browsable in addition to roots derived from
// persisted sessions. Stored on globalThis so Next.js hot-reload keeps them.
declare global {
  var __piAllowedRootsCache: { roots: Set<string>; expiresAt: number } | undefined;
  var __piAdditionalAllowedRoots: Set<string> | undefined;
}

const MAX_ALLOWED_ROOTS = 1000;

export function normalizeSlashes(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

export function getAdditionalAllowedRoots(): Set<string> {
  if (!globalThis.__piAdditionalAllowedRoots) {
    globalThis.__piAdditionalAllowedRoots = new Set();
  }
  return globalThis.__piAdditionalAllowedRoots;
}

export function allowFileRoot(root: string): void {
  if (!root) return;
  const roots = getAdditionalAllowedRoots();
  if (roots.size >= MAX_ALLOWED_ROOTS) {
    // Evict oldest entries (Set iteration order = insertion order)
    const evictCount = Math.ceil(MAX_ALLOWED_ROOTS * 0.1);
    let evicted = 0;
    for (const key of roots) {
      if (evicted >= evictCount) break;
      roots.delete(key);
      globalThis.__piAllowedRootsCache?.roots.delete(key);
      evicted++;
    }
  }
  const normalizedRoot = normalizeSlashes(root);
  roots.add(normalizedRoot);
  globalThis.__piAllowedRootsCache?.roots.add(normalizedRoot);
}
