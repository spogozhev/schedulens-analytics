/**
 * recompute-simultaneous.ts
 *
 * Recomputes the `simultaneousGroupId` field on every ScheduleEvent row
 * using the corrected back-to-back boundary rule: two events that merely
 * touch at a boundary (a.end === b.start) are NOT simultaneous, only
 * strictly overlapping intervals (b.start < a.maxEnd) are grouped.
 *
 * Use this script after editing the overlap rule in `import-schedules.ts`
 * to fix the existing database without re-importing all 5000+ JSON files.
 *
 * Performance: uses SQLite PRAGMAs + a single transaction, just like the
 * import script. For 5000 teachers, the original script took ~100s; this
 * version should finish in ~1-2s.
 *
 * Usage:  bun run scripts/recompute-simultaneous.ts
 */

import { db } from '../src/lib/db'
import type { Prisma } from '@prisma/client'

async function setupPragmas(): Promise<void> {
  // See import-schedules.ts for rationale. We deliberately DO NOT set
  // `locking_mode = EXCLUSIVE` because it can leave a stale WAL lock on
  // re-runs (the second invocation blocks until socket timeout).
  await db.$queryRawUnsafe('PRAGMA journal_mode = WAL')
  await db.$queryRawUnsafe('PRAGMA synchronous = NORMAL')
  await db.$queryRawUnsafe('PRAGMA cache_size = -134217728')
  await db.$queryRawUnsafe('PRAGMA temp_store = MEMORY')
  await db.$queryRawUnsafe('PRAGMA mmap_size = 268435456')
}

async function computeSimultaneousGroups(
  tx: Prisma.TransactionClient,
  educatorIds: number[],
): Promise<{ teachers: number; groups: number; simultaneousEvents: number; teachersWithSim: number }> {
  let groupCount = 0
  let simultaneousEvents = 0
  let teachersWithSim = 0
  let groupCounter = 0

  for (let i = 0; i < educatorIds.length; i++) {
    const teacherId = educatorIds[i]
    const events = await tx.scheduleEvent.findMany({
      where: { educatorId: teacherId },
      orderBy: { startDateTime: 'asc' },
      select: { id: true, startDateTime: true, endDateTime: true },
    })
    if (events.length === 0) continue

    // Sweep-line: group strictly overlapping (chained) intervals.
    // IMPORTANT: back-to-back events (a.end === b.start) are NOT simultaneous.
    type G = { ids: string[]; maxEnd: number; minStart: number }
    const groups: G[] = []
    let cur: G | null = null
    for (const ev of events) {
      const s = ev.startDateTime.getTime()
      const e = ev.endDateTime.getTime()
      if (cur && s < cur.maxEnd) {
        cur.ids.push(ev.id)
        cur.maxEnd = Math.max(cur.maxEnd, e)
        cur.minStart = Math.min(cur.minStart, s)
      } else {
        cur = { ids: [ev.id], maxEnd: e, minStart: s }
        groups.push(cur)
      }
    }

    let hadSim = false
    for (const g of groups) {
      if (g.ids.length <= 1) continue
      const groupId = `sim-${teacherId}-${groupCounter++}`
      await tx.scheduleEvent.updateMany({
        where: { id: { in: g.ids } },
        data: { simultaneousGroupId: groupId },
      })
      groupCount++
      simultaneousEvents += g.ids.length
      hadSim = true
    }
    if (hadSim) teachersWithSim++

    if ((i + 1) % 100 === 0 || i === educatorIds.length - 1) {
      console.log(`  Processed ${i + 1}/${educatorIds.length} teachers, ${groupCount} groups so far.`)
    }
  }

  return { teachers: educatorIds.length, groups: groupCount, simultaneousEvents, teachersWithSim }
}

async function main() {
  const t0 = Date.now()
  console.log('Recomputing simultaneous groups…')

  console.log('Setting SQLite PRAGMAs…')
  await setupPragmas()

  // Reset existing simultaneousGroupId (outside transaction — if the
  // recomputation fails, we want a clean state, not the old groups restored).
  console.log('Clearing existing simultaneousGroupId…')
  await db.scheduleEvent.updateMany({
    where: { simultaneousGroupId: { not: null } },
    data: { simultaneousGroupId: null },
  })

  // Only primary educators (id > 0) have simultaneous groups computed.
  const educators = await db.educator.findMany({
    where: { id: { gt: 0 } },
    select: { id: true },
  })
  const educatorIds = educators.map((e) => e.id)
  console.log(`Found ${educatorIds.length} primary educators.`)

  // Run the recomputation in a single transaction.
  const tStart = Date.now()
  let result: { teachers: number; groups: number; simultaneousEvents: number; teachersWithSim: number }
  try {
    result = await db.$transaction(
      async (tx) => computeSimultaneousGroups(tx, educatorIds),
      { maxWait: 60_000, timeout: 7_200_000 },
    )
  } catch (e) {
    console.error('Transaction failed:', (e as Error).message)
    throw e
  }
  const tEnd = Date.now()

  console.log('--- Summary ---')
  console.log(`Teachers: ${result.teachers}`)
  console.log(`Teachers with simultaneous groups: ${result.teachersWithSim}`)
  console.log(`Simultaneous groups: ${result.groups}`)
  console.log(`Simultaneous events: ${result.simultaneousEvents}`)
  console.log('--- Timing ---')
  console.log(`Recompute: ${((tEnd - tStart) / 1000).toFixed(2)}s`)
  console.log(`Total:    ${((tEnd - t0) / 1000).toFixed(2)}s`)

  // Sanity: re-fetch totals.
  const totalEvents = await db.scheduleEvent.count()
  const totalSim = await db.scheduleEvent.count({ where: { simultaneousGroupId: { not: null } } })
  const distinctSim = await db.scheduleEvent.findMany({
    where: { simultaneousGroupId: { not: null } },
    distinct: ['simultaneousGroupId'],
    select: { simultaneousGroupId: true },
  })
  console.log(`Total events: ${totalEvents}`)
  console.log(`Events flagged simultaneous (re-checked): ${totalSim}`)
  console.log(`Distinct simultaneous groups (re-checked): ${distinctSim.length}`)

  await db.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
