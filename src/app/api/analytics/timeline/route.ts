import { NextResponse } from 'next/server'
import {
  buildEventWhere,
  computeTimeline,
  dayName,
  hourOf,
  type CommonFilters,
} from '@/lib/analytics'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const filters: CommonFilters = {
    from: url.searchParams.get('from'),
    to: url.searchParams.get('to'),
    kindCode: url.searchParams.get('kindCode'),
    includeCanceled: url.searchParams.get('includeCanceled') ?? 'false',
  }
  const where = buildEventWhere(filters)
  const granularity = (url.searchParams.get('granularity') || 'week') as 'day' | 'week'

  const [timeline, byDayOfWeek, byHour, heatmapAgg] = await Promise.all([
    computeTimeline(where, granularity),
    db.scheduleEvent.groupBy({ by: ['dayOfWeek'], where, _count: { _all: true } }),
    db.scheduleEvent.findMany({
      where,
      select: { startDateTime: true, durationMinutes: true, simultaneousGroupId: true, id: true, endDateTime: true },
    }).then((events) => {
      const byHour: { hour: number; events: number; minutes: number; simultaneous: number }[] = Array.from(
        { length: 24 },
        (_, h) => ({ hour: h, events: 0, minutes: 0, simultaneous: 0 }),
      )
      for (const e of events) {
        const h = hourOf(e.startDateTime)
        byHour[h].events++
        byHour[h].minutes += e.durationMinutes
        if (e.simultaneousGroupId) byHour[h].simultaneous++
      }
      return byHour
    }),
    (async () => {
      const events = await db.scheduleEvent.findMany({
        where,
        select: { startDateTime: true, simultaneousGroupId: true, dayOfWeek: true },
      })
      const heatmap: { day: number; dayName: string; hour: number; events: number; simultaneous: number }[][] =
        Array.from({ length: 7 }, (_, d) =>
          Array.from({ length: 24 }, (_, h) => ({
            day: d + 1,
            dayName: dayName(d + 1),
            hour: h,
            events: 0,
            simultaneous: 0,
          })),
        )
      for (const e of events) {
        const h = hourOf(e.startDateTime)
        const d = e.dayOfWeek
        if (d >= 1 && d <= 7) {
          heatmap[d - 1][h].events++
          if (e.simultaneousGroupId) heatmap[d - 1][h].simultaneous++
        }
      }
      return heatmap
    })(),
  ])

  return NextResponse.json({
    granularity,
    timeline,
    byDayOfWeek: byDayOfWeek
      .map((d) => ({
        day: d.dayOfWeek,
        dayName: dayName(d.dayOfWeek),
        events: d._count._all,
      }))
      .sort((a, b) => a.day - b.day),
    byHour,
    heatmap: heatmapAgg,
  })
}
