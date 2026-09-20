/**
 * invalidate-cache.ts
 *
 * Ask a running dev/prod server to drop its slow-query cache after the
 * dataset has changed (import / recompute scripts). The cache lives inside
 * the Next.js server process, so the CLI cannot clear it directly — this
 * just calls DELETE /api/admin/slow-cache (see src/app/api/admin/slow-cache).
 *
 * Failure is never fatal: if no server is running (or it is unreachable),
 * the script prints a warning and exits normally — a server restart clears
 * the cache anyway, and a cold server has nothing cached.
 *
 * Env:
 *   APP_URL            — server base URL (default http://localhost:3000)
 *   SLOW_CACHE_TOKEN   — must match the server's token, when one is set
 */

export async function invalidateServerCache(): Promise<void> {
  const base = (process.env.APP_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
  const url = `${base}/api/admin/slow-cache`;
  const headers: Record<string, string> = {};
  if (process.env.SLOW_CACHE_TOKEN) headers['x-cache-token'] = process.env.SLOW_CACHE_TOKEN;
  try {
    const res = await fetch(url, { method: 'DELETE', headers });
    if (!res.ok) {
      console.warn(`Slow-cache invalidation failed: HTTP ${res.status} from ${url}`);
      return;
    }
    const body = (await res.json().catch(() => null)) as { dropped?: number } | null;
    console.log(
      `Server slow-cache cleared${body?.dropped !== undefined ? ` (${body.dropped} entries)` : ''}: ${url}`,
    );
  } catch (e) {
    console.warn(`Slow-cache invalidation skipped (server not reachable at ${url}): ${(e as Error).message}`);
  }
}
