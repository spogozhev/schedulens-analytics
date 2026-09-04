import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  buildEventWhere,
  computeTeacherWorkloads,
  computeRoomWorkloads,
  computeTimeline,
  computeOverviewKpis,
  getDateBounds,
  KIND_LABELS,
  type CommonFilters,
} from '@/lib/analytics'

export const dynamic = 'force-dynamic'

/**
 * Overview endpoint. Optimized for universities with 5000+ teachers and
 * 1000+ rooms:
 *
 *   - KPI totals are computed via SQL aggregation in `computeOverviewKpis`,
 *     so we never load the full per-teacher workloads just to sum minutes.
 *   - Top-10 teachers and top-10 rooms still require per-teacher / per-room
 *     workload computation, but we only fetch educators/rooms that have
 *     events in the active filter period (not the entire roster).
 *   - `filterOptions.educators` and `filterOptions.rooms` are NOT returned
 *     here — the client should use the dedicated paginated endpoints with
 *     server-side search instead. Only `filterOptions.kinds` (3 fixed
 *     options) is returned.
 */
export async function GET(request: Request) {
  const url = new URL(request.url)
  const filters: CommonFilters = {
    from: url.searchParams.get('from'),
    to: url.searchParams.get('to'),
    kindCode: url.searchParams.get('kindCode'),
    includeCanceled: url.searchParams.get('includeCanceled') ?? 'false',
  }
  const where = buildEventWhere(filters)

  const bounds = await getDateBounds()

  // Run KPIs, kind aggregation, timeline, and top-N in parallel.
  // For top-N we compute all workloads (limited to teachers/rooms with
  // events in the filter range) and slice to top 10.
  const [kpis, kindAgg, timeline, teachers, rooms] = await Promise.all([
    computeOverviewKpis(where),
    db.scheduleEvent.groupBy({ by: ['kindCode'], where, _count: { _all: true } }),
    computeTimeline(where, 'week'),
    computeTeacherWorkloads(where).then((ws) =>
      ws.sort((a, b) => b.effectiveMinutes - a.effectiveMinutes).slice(0, 10),
    ),
    computeRoomWorkloads(where).then((ws) =>
      ws.sort((a, b) => b.totalMinutes - a.totalMinutes).slice(0, 10),
    ),
  ])

  const byKind = kindAgg.map((k) => ({
    kindCode: k.kindCode,
    label: KIND_LABELS[k.kindCode] ?? `Тип ${k.kindCode}`,
    count: k._count._all,
  }))

  return NextResponse.json({
    dateBounds: bounds
      ? { from: bounds.from.toISOString(), to: bounds.to.toISOString() }
      : null,
    kpis: {
      teachers: kpis.teachersCount,
      events: kpis.eventsCount,
      rooms: kpis.roomsCount,
      subjects: kpis.subjectsCount,
      groups: kpis.groupsCount,
      scheduledHours: Math.round((kpis.scheduledMinutes / 60) * 10) / 10,
      effectiveHours: Math.round((kpis.effectiveMinutes / 60) * 10) / 10,
      simultaneousEvents: kpis.simultaneousEvents,
      simultaneousGroups: kpis.simultaneousGroups,
      inferredEndEvents: kpis.inferredEndEvents,
      timeSavedHours: Math.round(((kpis.scheduledMinutes - kpis.effectiveMinutes) / 60) * 10) / 10,
    },
    byKind,
    timeline,
    topTeachers: teachers.map((t) => ({
      id: t.id,
      name: t.displayName,
      longName: t.longName,
      events: t.eventsCount,
      scheduledHours: Math.round((t.scheduledMinutes / 60) * 10) / 10,
      effectiveHours: Math.round((t.effectiveMinutes / 60) * 10) / 10,
      simultaneousGroups: t.simultaneousGroups,
    })),
    topRooms: rooms.map((r) => ({
      id: r.id,
      name: r.displayName,
      events: r.eventsCount,
      uniqueLectures: r.uniqueLectures,
      hours: Math.round((r.totalMinutes / 60) * 10) / 10,
      conflicts: r.conflicts,
    })),
    // Only kinds are returned — educator/room filter options are now
    // fetched via the dedicated paginated endpoints with server-side search.
    filterOptions: {
      kinds: Object.entries(KIND_LABELS).map(([code, label]) => ({ kindCode: Number(code), label })),
    },
  })
}
