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
 * Usage:  bun run scripts/recompute-simultaneous.ts
 */

import { db } from '../src/lib/db'

async function main() {
  console.log('Recomputing simultaneous groups…')

  // Reset existing simultaneousGroupId across all events.
  console.log('Clearing existing simultaneousGroupId…')
  await db.scheduleEvent.updateMany({ where: { simultaneousGroupId: { not: null } }, data: { simultaneousGroupId: null } })

  // Only primary educators (id > 0) have simultaneous groups computed.
  const teachers = await db.educator.findMany({ where: { id: { gt: 0 } } })
  console.log(`Found ${teachers.length} primary educators.`)

  let groupCount = 0
  let simultaneousEvents = 0
  let teachersWithSim = 0
  let groupCounter = 0

  for (let i = 0; i < teachers.length; i++) {
    const teacher = teachers[i]
    const events = await db.scheduleEvent.findMany({
      where: { educatorId: teacher.id },
      orderBy: { startDateTime: 'asc' },
      select: { id: true, startDateTime: true, endDateTime: true },
    })
    if (events.length === 0) continue

    // Sweep-line: group strictly overlapping (chained) intervals.
    // IMPORTANT: back-to-back events (a.end === b.start) are NOT simultaneous.
    // We use `s < cur.maxEnd` (strict inequality) so that touching intervals
    // form separate groups.
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
      const groupId = `sim-${teacher.id}-${groupCounter++}`
      await db.scheduleEvent.updateMany({
        where: { id: { in: g.ids } },
        data: { simultaneousGroupId: groupId },
      })
      groupCount++
      simultaneousEvents += g.ids.length
      hadSim = true
    }
    if (hadSim) teachersWithSim++

    if ((i + 1) % 50 === 0 || i === teachers.length - 1) {
      console.log(`  Processed ${i + 1}/${teachers.length} teachers, ${groupCount} groups so far.`)
    }
  }

  console.log('--- Summary ---')
  console.log(`Teachers: ${teachers.length}`)
  console.log(`Teachers with simultaneous groups: ${teachersWithSim}`)
  console.log(`Simultaneous groups: ${groupCount}`)
  console.log(`Simultaneous events: ${simultaneousEvents}`)

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
