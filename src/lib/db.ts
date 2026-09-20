import { PrismaClient } from '@prisma/client'

// Dual-dialect support: the DBMS is chosen at deployment time via DATABASE_URL:
//   file:…                → SQLite (default for development)
//   postgresql://…        → PostgreSQL
// Raw SQL that differs between them is parameterized in src/lib/sql-dialect.ts.
const isSqlite = !(process.env.DATABASE_URL ?? '').trim().toLowerCase().startsWith('postgres')

// Query timing log: queries with duration >= DB_LOG_SLOW_MS are printed as
// `[db   123ms] SELECT ...`. DISABLED by default. To enable, set:
//   DB_LOG_SLOW_MS=0    — log every query
//   DB_LOG_SLOW_MS=200  — log only queries slower than 200ms
const slowQueryMs = process.env.DB_LOG_SLOW_MS !== undefined ? Number(process.env.DB_LOG_SLOW_MS) : -1

// The explicit generics carry the "query" event config and the datasource URL
// into the client type so that `db.$on('query', ...)` below is properly typed
// and `datasourceUrl` passes the Subset<> option check (inference from the
// constructor argument alone collapses the event union to `never`).
type LogConfig = [{ emit: 'event'; level: 'query' }, 'error', 'warn']
type ClientOptions = { log: LogConfig; datasourceUrl: string }
type PrismaClientWithQueryLog = PrismaClient<ClientOptions, 'query'>

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClientWithQueryLog | undefined
}

// SQLite must use a single pooled connection: SQLite page caches are
// per-connection, so the default multi-connection pool re-reads the same
// pages into several cold caches (measured 4x slower joins on a 400k-event
// dataset). PostgreSQL manages its own cache server-side and benefits from
// a regular pool, so the parameter is only added for SQLite.
function withSqliteTuning(url: string): string {
  if (!isSqlite || url.includes('connection_limit')) return url
  return url + (url.includes('?') ? '&' : '?') + 'connection_limit=1'
}

// 128MB page cache + in-memory temp tables (GROUP BY / DISTINCT scratch):
// measured ~4x faster room joins on a 400k-event dataset. SQLite-only —
// PostgreSQL equivalents (shared_buffers, work_mem) are server-side settings.
// Set DB_CACHE_KB=0 to keep SQLite's tiny default.
const cacheKb = process.env.DB_CACHE_KB ? Number(process.env.DB_CACHE_KB) : -131072

export const db: PrismaClientWithQueryLog =
  globalForPrisma.prisma ??
  new PrismaClient<ClientOptions, 'query'>({
    // Quiet default logging; query timing is emitted via the `query` event below.
    log: [{ emit: 'event', level: 'query' }, 'error', 'warn'],
    datasourceUrl: withSqliteTuning(process.env.DATABASE_URL ?? 'file:./dev.db'),
  })

db.$on('query', (e) => {
  if (slowQueryMs >= 0 && e.duration >= slowQueryMs) {
    const sql = e.query.length > 300 ? `${e.query.slice(0, 300)}…` : e.query
    console.log(`[db ${String(e.duration).padStart(5)}ms] ${sql}`)
  }
})

// PRAGMAs are per-connection; with connection_limit=1 the connection opened
// here serves the whole process. PostgreSQL needs no client-side pragmas.
if (isSqlite && cacheKb !== 0) {
  db.$executeRawUnsafe(`PRAGMA cache_size = ${cacheKb}`).catch((e) =>
    console.warn('[db] PRAGMA cache_size failed:', e),
  )
  db.$executeRawUnsafe('PRAGMA temp_store = MEMORY').catch((e) =>
    console.warn('[db] PRAGMA temp_store failed:', e),
  )
}

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
