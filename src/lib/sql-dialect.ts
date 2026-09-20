/**
 * SQL dialect helpers for dual SQLite/PostgreSQL support.
 *
 * The dialect is derived from DATABASE_URL at deployment time:
 *   file:…        → SQLite
 *   postgres://…  → PostgreSQL
 * Prisma-level queries are dialect-agnostic; only the raw SQL in
 * analytics.ts needs these parameterized fragments.
 */
export const isPostgres = !(process.env.DATABASE_URL ?? '')
  .trim()
  .toLowerCase()
  .startsWith('file:')

export const isSqlite = !isPostgres

/**
 * Expression that converts a millisecond-epoch DateTime column to a UTC
 * timestamp value usable by date-part functions.
 * NOTE: pinned to UTC — PG's to_timestamp()/to_char() otherwise use the
 * server timezone.
 */
export function toTimestamp(colExpr: string): string {
  return isPostgres
    ? `to_timestamp(EXTRACT(EPOCH FROM ${colExpr})) AT TIME ZONE 'UTC'`
    : `datetime(${colExpr} / 1000, 'unixepoch')`
}

/** 'YYYY-MM-DD' day bucket key (matches the JS dayKey format). */
export function dayBucketExpr(colExpr: string): string {
  return isPostgres
    ? `to_char(${toTimestamp(colExpr)}, 'YYYY-MM-DD')`
    : `strftime('%Y-%m-%d', ${toTimestamp(colExpr)})`
}

/** ISO-8601 week bucket key 'YYYY-Www' (matches the JS isoWeek label). */
export function isoWeekBucketExpr(colExpr: string): string {
  if (isPostgres) {
    // IYYY = ISO year, IW = ISO week number (both native in PG).
    return `to_char(${toTimestamp(colExpr)}, 'IYYY-"W"IW')`
  }
  // ISO week: shift to the week's Thursday, take its year and day-of-year.
  const thu = `${toTimestamp(colExpr)}, '-3 days', 'weekday 4'`
  return `printf('%04d-W%02d', CAST(strftime('%Y', ${thu}) AS INTEGER), (CAST(strftime('%j', ${thu}) AS INTEGER) - 1) / 7 + 1)`
}

/** Month number 1–12 as INTEGER. */
export function monthExpr(colExpr: string): string {
  return isPostgres
    ? `EXTRACT(MONTH FROM ${toTimestamp(colExpr)})::int`
    : `CAST(strftime('%m', ${toTimestamp(colExpr)}) AS INTEGER)`
}

/** Hour number 0–23 as INTEGER. */
export function hourExpr(colExpr: string): string {
  return isPostgres
    ? `EXTRACT(HOUR FROM ${toTimestamp(colExpr)})::int`
    : `CAST(strftime('%H', ${toTimestamp(colExpr)}) AS INTEGER)`
}

/** Boolean literal for raw SQL ("0" in SQLite, "false" in PG). */
export const boolFalse = isPostgres ? 'false' : '0'

/**
 * Expression that yields a Unix-epoch-milliseconds NUMBER from a timestamp
 * expression. On SQLite DateTime columns already hold integer ms; on PG
 * MIN/MAX of timestamp produce timestamp, and subtraction produces an
 * interval — so we convert explicitly.
 */
export function epochMillis(colExpr: string): string {
  return isPostgres
    ? `(EXTRACT(EPOCH FROM ${colExpr}) * 1000)`
    : colExpr
}

/**
 * Convert `?` placeholders to PostgreSQL's numbered `$n` form. Prisma's
 * $queryRawUnsafe does not translate `?` for PG (it does for SQLite/MySQL).
 */
export function adaptPlaceholders(sql: string): string {
  if (!isPostgres) return sql
  let i = 0
  return sql.replace(/\?/g, () => `$${++i}`)
}

/**
 * ESCAPE literal for LIKE patterns produced by likeEscape()
 * (single backslash character in the SQL text on both dialects).
 */
export const likeEscapeClause = String.raw`ESCAPE '\'`
