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

/** Month names in Russian (1-indexed for clarity). */
const MONTH_NAMES_RU = [
  '', 'Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн',
  'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек',
]

/**
 * Aggregate events by (month, kindCode) using raw SQL — much faster than
 * pulling all events into JS and grouping there. Returns a flat array of
 * `{ month, kindCode, count }` rows.
 *
 * Uses SQLite's `strftime` to extract the month from `startDateTime` (stored
 * in ISO 8601 / Prisma DateTime). The WHERE clause mirrors the same filters
 * as the rest of the overview endpoint.
 */
async function computeByMonthByKind(
  where: import('@prisma/client').Prisma.ScheduleEventWhereInput,
): Promise<{ month: number; monthLabel: string; kindCode: number; count: number }[]> {
  // Build a raw SQL filter matching `buildEventWhere`. We translate the
  // common filters (date range, kindCode, isCanceled) into SQL conditions.
  //
  // IMPORTANT: `startDateTime` is stored as a Unix epoch in MILLISECONDS.
  // To compare with ISO date strings (e.g. "2026-02-01T00:00:00.000Z") we
  // use `strftime('%s', ?) * 1000` to convert the ISO string to the same
  // millisecond epoch. (`strftime('%s', ...)` returns seconds; *1000 → ms.)
  const conditions: string[] = []
  const params: (string | number)[] = []
  if (where.startDateTime && typeof where.startDateTime === 'object') {
    const s = where.startDateTime as { gte?: Date; lte?: Date }
    if (s.gte) {
      conditions.push('startDateTime >= CAST(strftime(\'%s\', ?) AS INTEGER) * 1000')
      params.push(s.gte.toISOString())
    }
    if (s.lte) {
      conditions.push('startDateTime <= CAST(strftime(\'%s\', ?) AS INTEGER) * 1000')
      params.push(s.lte.toISOString())
    }
  }
  if (where.kindCode !== undefined && typeof where.kindCode === 'number') {
    conditions.push('kindCode = ?')
    params.push(where.kindCode)
  }
  if (where.isCanceled === false) {
    conditions.push('isCanceled = 0')
  }
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

  // Group by month (1-12) and kindCode.
  //
  // SQLite (Prisma provider) stores `DateTime` as a Unix epoch in
  // MILLISECONDS (integer). To extract the month we first divide by 1000
  // to get seconds, then convert to a UTC timestamp via `datetime(...,
  // 'unixepoch')`, and finally extract the month with `strftime('%m', ...)`.
  // `strftime('%m', ...)` returns zero-padded month ("02") — strip the
  // leading zero with `CAST(... AS INTEGER)`.
  //
  // Note: COUNT(*) returns a BigInt in better-sqlite3 / Prisma raw queries,
  // so we wrap it in `CAST(... AS INTEGER)` to get a JS number.
  const rows = (await db.$queryRawUnsafe(
    `SELECT CAST(strftime('%m', datetime(startDateTime / 1000, 'unixepoch')) AS INTEGER) AS month,
            kindCode,
            CAST(COUNT(*) AS INTEGER) AS count
       FROM ScheduleEvent
       ${whereClause}
       GROUP BY month, kindCode
       ORDER BY month ASC, kindCode ASC`,
    ...params,
  )) as Array<{ month: number; kindCode: number; count: number }>

  return rows.map((r) => ({
    // SQLite returns BigInt for COUNT and CAST-INTEGER columns even when
    // we CAST them. Coerce to Number for JS-friendly JSON serialization.
    month: Number(r.month),
    monthLabel: MONTH_NAMES_RU[Number(r.month)] ?? `М${r.month}`,
    kindCode: Number(r.kindCode),
    count: Number(r.count),
  }))
}

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

  // Run KPIs, kind aggregation, timeline, top-N, and by-month-by-kind in parallel.
  // For top-N we compute all workloads (limited to teachers/rooms with
  // events in the filter range) and slice to top 10.
  const [kpis, kindAgg, timeline, teachers, rooms, byMonthByKind] = await Promise.all([
    computeOverviewKpis(where),
    db.scheduleEvent.groupBy({ by: ['kindCode'], where, _count: { _all: true } }),
    computeTimeline(where, 'week'),
    computeTeacherWorkloads(where).then((ws) =>
      ws.sort((a, b) => b.effectiveMinutes - a.effectiveMinutes).slice(0, 10),
    ),
    computeRoomWorkloads(where).then((ws) =>
      ws.sort((a, b) => b.totalMinutes - a.totalMinutes).slice(0, 10),
    ),
    computeByMonthByKind(where),
  ])

  const byKind = kindAgg.map((k) => ({
    kindCode: k.kindCode,
    label: KIND_LABELS[k.kindCode] ?? `Тип ${k.kindCode}`,
    count: k._count._all,
  }))

  // Reshape byMonthByKind for stacked bar chart: array of {month, [kindLabel]: count}.
  // Months present in the data (sorted). For each month, an object with
  // `month` (label) and one numeric field per kind label.
  const monthsPresent = [...new Set(byMonthByKind.map((r) => r.month))].sort((a, b) => a - b)
  const byMonthStacked = monthsPresent.map((m) => {
    const row: Record<string, number | string> = {
      month: MONTH_NAMES_RU[m] ?? `М${m}`,
    }
    for (const [code, label] of Object.entries(KIND_LABELS)) {
      const found = byMonthByKind.find((r) => r.month === m && r.kindCode === Number(code))
      row[label] = found ? found.count : 0
    }
    return row
  })

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
    byMonthByKind: byMonthStacked,
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
