/**
 * Simple in-memory sliding-window rate limiter for enterprise API routes.
 * NOT suitable for multi-instance deployments — use Redis/PG for that.
 */

interface Bucket {
  hits: number[];
}

const buckets = new Map<string, Bucket>();

/**
 * Check whether `key` is within the rate limit.
 * Returns `true` if allowed, `false` if the limit is exceeded.
 */
export function checkRateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = { hits: [] };
    buckets.set(key, bucket);
  }

  // Prune stale entries
  bucket.hits = bucket.hits.filter((t) => now - t < windowMs);

  if (bucket.hits.length >= limit) return false;
  bucket.hits.push(now);
  return true;
}

/**
 * Default key extractor — uses x-forwarded-for or "anonymous".
 */
export function getClientKey(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return "anonymous";
}
