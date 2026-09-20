// @ts-nocheck — dev-only migration script; bun:sqlite types are not installed.
/**
 * One-time data migration for the denormalized primary location:
 *
 *   1. ScheduleEvent.locationId := MIN(locationId) over the event's
 *      ScheduleEventLocation rows (deterministic "first" location).
 *   2. ScheduleEventLocation keeps only ADDITIONAL locations — rows whose
 *      locationId equals the event's primary are removed. This shrinks the
 *      links table from ~470k rows to ~52k (only multi-room events remain).
 *
 * Idempotent: re-running performs no changes. Run `prisma db push` first so
 * the locationId column exists.
 *
 * Usage:
 *   DATABASE_URL="file:<abs path to db>" bun scripts/migrate-primary-location.ts
 */
import { Database } from 'bun:sqlite'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

// `file:` URLs may carry query params; bun auto-loads .env where DATABASE_URL
// is relative to the prisma/ dir — try cwd-relative first, then prisma-relative.
function resolveDbPath(url: string): string {
  const p = url.replace(/^file:/, '').split('?')[0]
  if (existsSync(p)) return p
  const viaPrisma = resolve(process.cwd(), 'prisma', p)
  if (existsSync(viaPrisma)) return viaPrisma
  return p
}
const dbPath = resolveDbPath(process.env.DATABASE_URL ?? 'file:./db/custom.db')

const db = new Database(dbPath)
db.exec('PRAGMA journal_mode = WAL')

const eventsTotal = (db.query('SELECT COUNT(*) c FROM ScheduleEvent').get() as { c: number }).c
const linksTotal = (db.query('SELECT COUNT(*) c FROM ScheduleEventLocation').get() as { c: number }).c
console.log(`before: ${eventsTotal} events, ${linksTotal} links`)

db.exec('BEGIN')
try {
  // 1. Backfill the primary location (MIN(locationId) per event).
  const t0 = performance.now()
  db.exec(`
    UPDATE ScheduleEvent
       SET locationId = src.primaryId
      FROM (
        SELECT eventId, MIN(locationId) AS primaryId
          FROM ScheduleEventLocation
         GROUP BY eventId
      ) AS src
     WHERE ScheduleEvent.id = src.eventId
       AND ScheduleEvent.locationId IS NULL
  `)
  const backfilled = db.query('SELECT COUNT(*) c FROM ScheduleEvent WHERE locationId IS NOT NULL').get() as { c: number }
  console.log(`backfill: ${backfilled.c}/${eventsTotal} events have a primary location (${Math.round(performance.now() - t0)}ms)`)

  // 2. Remove link rows that duplicate the primary location.
  const t1 = performance.now()
  db.exec(`
    DELETE FROM ScheduleEventLocation
     WHERE locationId = (SELECT locationId FROM ScheduleEvent WHERE id = ScheduleEventLocation.eventId)
  `)
  const linksAfter = (db.query('SELECT COUNT(*) c FROM ScheduleEventLocation').get() as { c: number }).c
  console.log(`prune: ${linksTotal - linksAfter} primary links removed, ${linksAfter} extra links remain (${Math.round(performance.now() - t1)}ms)`)

  db.exec('COMMIT')
} catch (e) {
  db.exec('ROLLBACK')
  throw e
}

// Sanity checks.
const nullPrimaries = (db.query('SELECT COUNT(*) c FROM ScheduleEvent WHERE locationId IS NULL').get() as { c: number }).c
const orphanPrimaries = (db.query(`
  SELECT COUNT(*) c FROM ScheduleEvent se
   WHERE se.locationId IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM Location l WHERE l.id = se.locationId)
`).get() as { c: number }).c
const dupLinks = (db.query(`
  SELECT COUNT(*) c FROM ScheduleEventLocation sel
   WHERE sel.locationId = (SELECT locationId FROM ScheduleEvent WHERE id = sel.eventId)
`).get() as { c: number }).c
console.log(`sanity: null primaries=${nullPrimaries}, invalid primaries=${orphanPrimaries}, duplicate links=${dupLinks}`)
db.close()
