/**
 * Adaptive in-process cache for slow analytics computations.
 *
 * The DB is read-only between imports (data changes only when an import
 * script runs), so any computed result stays valid until the next import.
 * Instead of caching everything, only computations that took at least
 * SLOW_CACHE_MS wall-clock on their first run are kept — cheap queries
 * pass through untouched and never occupy memory.
 *
 * Lookup key = computation name + hash of the stable-serialized arguments
 * (object keys sorted, `undefined` fields dropped), so logically identical
 * calls share one entry regardless of argument construction order.
 *
 * Concurrency: the in-flight Promise is stored immediately, so parallel
 * callers of the same cold computation join it instead of racing the DB
 * (joining an in-flight computation also logs as HIT). A computation that
 * finishes below the threshold, or rejects, removes itself.
 *
 * The Map keeps insertion order and is capped at SLOW_CACHE_MAX_ENTRIES —
 * the oldest entry is evicted, hits re-insert to refresh recency. Results
 * are stored as live objects with no serialization, which keeps BigInt
 * values returned by raw PG queries safe.
 *
 * Invalidation is all-or-nothing: the import scripts drop the whole cache
 * via DELETE /api/admin/slow-cache (see scripts/invalidate-cache.ts); a
 * server restart has the same effect. No per-entry invalidation exists on
 * purpose — between imports the data never changes.
 *
 * Config (env):
 *   SLOW_CACHE_MS=1000          — min duration for a result to be cached
 *   SLOW_CACHE_MAX_ENTRIES=200  — size cap; 0 disables the cache entirely
 *
 * Logs (always on, mirrors the [t …]/[db …] style of timing.ts / db.ts):
 *   [cache HIT  ] teacherWorkloads
 *   [cache STORE] teacherWorkloads 1450ms (entries=3)
 *   [cache CLEAR] dropped=3
 */
import { createHash } from 'node:crypto'

const storeThresholdMs =
  process.env.SLOW_CACHE_MS !== undefined ? Number(process.env.SLOW_CACHE_MS) : 1000
const maxEntries =
  process.env.SLOW_CACHE_MAX_ENTRIES !== undefined ? Number(process.env.SLOW_CACHE_MAX_ENTRIES) : 200

// Survive Next.js dev HMR module reloads — same trick as the prisma client in db.ts.
const globalForCache = globalThis as unknown as {
  slowCacheStore: Map<string, Promise<unknown>> | undefined
}
const store: Map<string, Promise<unknown>> = globalForCache.slowCacheStore ?? new Map()
if (process.env.NODE_ENV !== 'production') globalForCache.slowCacheStore = store

/**
 * Deterministic JSON: object keys sorted, undefined-valued properties
 * dropped, Dates as ISO strings. Arrays keep their order.
 */
function stableStringify(value: unknown): string {
  if (value === null) return 'null'
  const t = typeof value
  if (t !== 'object') return JSON.stringify(value) ?? t
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`
}

function makeKey(name: string, args: unknown): string {
  const hash = createHash('sha1').update(stableStringify(args)).digest('hex').slice(0, 16)
  return `${name}:${hash}`
}

/**
 * Run `fn` under the slow-query cache. `args` participates in the cache
 * key (stable-serialized) — pass every value the result depends on.
 */
export function slowCached<T>(name: string, args: unknown, fn: () => Promise<T>): Promise<T> {
  if (maxEntries <= 0) return fn()
  const key = makeKey(name, args)
  const inflight = store.get(key)
  if (inflight) {
    store.delete(key)
    store.set(key, inflight)
    console.log(`[cache HIT] ${name}`)
    return inflight as Promise<T>
  }
  const started = performance.now()
  const promise = fn().then(
    (result) => {
      const ms = Math.round(performance.now() - started)
      if (ms >= storeThresholdMs && store.get(key) === promise) {
        console.log(`[cache STORE] ${name} ${ms}ms (entries=${store.size})`)
      } else {
        // Fast (or already evicted) — drop so cheap calls never linger.
        store.delete(key)
      }
      return result
    },
    (error: unknown) => {
      store.delete(key)
      throw error
    },
  )
  store.set(key, promise)
  while (store.size > maxEntries) {
    const oldest = store.keys().next().value
    if (oldest === undefined || oldest === key) break
    store.delete(oldest)
  }
  return promise
}

/** Drop every cached entry. Returns how many were dropped. */
export function clearSlowCache(): number {
  const dropped = store.size
  store.clear()
  if (dropped > 0) console.log(`[cache CLEAR] dropped=${dropped}`)
  return dropped
}

/** Number of entries currently held (including in-flight computations). */
export function slowCacheSize(): number {
  return store.size
}
