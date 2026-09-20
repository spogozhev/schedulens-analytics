/**
 * Server-side step timing for analytics endpoints.
 *
 * Logs the wall-clock duration of a computation to the console:
 *   [t    123ms] teachers-list:total
 *
 * This complements the per-SQL-query log from `db.ts`: the difference
 * between a step's total time and the sum of its SQL query times is time
 * spent materializing rows and aggregating in JS.
 *
 * DISABLED by default. To enable, set:
 *   ANALYTICS_LOG_SLOW_MS=0    — log every step
 *   ANALYTICS_LOG_SLOW_MS=200  — log only steps slower than 200ms
 */
const slowOpMs = process.env.ANALYTICS_LOG_SLOW_MS !== undefined
  ? Number(process.env.ANALYTICS_LOG_SLOW_MS)
  : -1

function logStep(label: string, start: number) {
  const ms = Math.round(performance.now() - start)
  if (slowOpMs >= 0 && ms >= slowOpMs) console.log(`[t ${String(ms).padStart(6)}ms] ${label}`)
}

export async function withTiming<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const start = performance.now()
  try {
    return await fn()
  } finally {
    logStep(label, start)
  }
}

export function withTimingSync<T>(label: string, fn: () => T): T {
  const start = performance.now()
  try {
    return fn()
  } finally {
    logStep(label, start)
  }
}
