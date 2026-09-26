/**
 * prune-educators.ts
 *
 * One-off cleanup: deletes Educator rows that have NO schedule events
 * (import-staff.ts used to create the full HR roster, including people who
 * no longer teach — they never appear in any analytics and only pollute
 * the matching pools). The criterion is exactly "no rows in ScheduleEvent":
 * synthetic co-teachers (negative ids) always have events, so they stay.
 *
 * Cascades (declared in schema.prisma): Employment, EmployeeMatch and
 * PlannedLoad rows of the deleted educators are removed with them.
 * EmployeeMatch re-appears after re-running import-employees.ts; PlannedLoad
 * for event-less educators is intentionally dropped (it is not visible in
 * the rating anyway, and after pruning the assignment matcher can no longer
 * pick event-less candidates).
 *
 * DRY-RUN by default: prints what would be deleted. Pass --apply to delete.
 *
 * API responses do not depend on event-less educators — verify with
 * golden-save/golden-check before and after (results must be identical).
 *
 * Usage:
 *   bun scripts/prune-educators.ts            # dry run
 *   bun scripts/prune-educators.ts --apply    # actually delete
 */
import { db } from '../src/lib/db'
import { invalidateServerCache } from './invalidate-cache'

/** COUNT(*) по беспараметрическому raw SQL (идентификаторы закавычены — оба диалекта). */
async function scalar(sql: string): Promise<number> {
  const rows = (await db.$queryRawUnsafe(sql)) as Array<{ c: number | bigint }>
  return Number(rows[0].c)
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply')

  const total = await scalar(`SELECT COUNT(*) AS c FROM "Educator"`)
  const withEvents = await scalar(
    `SELECT COUNT(DISTINCT "educatorId") AS c FROM "ScheduleEvent"`,
  )
  // The same NOT EXISTS criterion as the DELETE below — stats and deletion
  // can never disagree.
  const toDelete = total - withEvents
  const withEmployments = await scalar(
    `SELECT COUNT(*) AS c FROM "Employment" em
      WHERE NOT EXISTS (SELECT 1 FROM "ScheduleEvent" se WHERE se."educatorId" = em."educatorId")`,
  )
  const withMatches = await scalar(
    `SELECT COUNT(*) AS c FROM "EmployeeMatch" m
      WHERE NOT EXISTS (SELECT 1 FROM "ScheduleEvent" se WHERE se."educatorId" = m."educatorId")`,
  )
  const withPlan = await scalar(
    `SELECT COUNT(*) AS c FROM "PlannedLoad" p
      WHERE NOT EXISTS (SELECT 1 FROM "ScheduleEvent" se WHERE se."educatorId" = p."educatorId")`,
  )

  console.log(
    `Educator rows: ${total}; with events: ${withEvents}; without events (to delete): ${toDelete}.`,
  )
  console.log(
    `  cascades: employments ${withEmployments}, employeeMatches ${withMatches}, plannedLoads ${withPlan}.`,
  )

  if (toDelete === 0) {
    console.log('Nothing to delete.')
    return
  }
  if (!apply) {
    console.log('DRY RUN — nothing deleted. Re-run with --apply to delete.')
    return
  }

  // `events: { none: {} }` compiles to a NOT EXISTS subquery (no huge IN
  // list) and re-checks the criterion inside the statement itself.
  // DB-level ON DELETE CASCADE removes the dependent rows.
  const deleted = await db.educator.deleteMany({ where: { events: { none: {} } } })

  const remaining = await db.educator.count()
  const remainingWithEvents = await scalar(
    `SELECT COUNT(DISTINCT "educatorId") AS c FROM "ScheduleEvent"`,
  )
  console.log(
    `Deleted ${deleted.count} educators; remaining: ${remaining} ` +
      `(with events: ${remainingWithEvents}, without: ${remaining - remainingWithEvents}).`,
  )

  // Display names / planned loads feed cached computations — drop the cache.
  await invalidateServerCache()
}

main()
  .then(() => db.$disconnect())
  .catch((e) => {
    console.error(e)
    return db.$disconnect().then(() => process.exit(1))
  })
