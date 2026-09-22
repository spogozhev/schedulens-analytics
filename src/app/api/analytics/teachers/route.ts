import { NextResponse } from 'next/server'
import {
  buildEventWhere,
  parseCommonFilters,
  computeTeacherWorkloadsPaginated,
  roundHours,
  type TeacherSortKey,
} from '@/lib/analytics'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const filters = parseCommonFilters(url)
  const where = buildEventWhere(filters)

  const sort = (url.searchParams.get('sort') as TeacherSortKey) || 'effectiveHours'
  const search = url.searchParams.get('search') || ''
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10))
  const pageSize = Math.max(1, Math.min(500, parseInt(url.searchParams.get('pageSize') || '50', 10)))

  // Optional first-level unit filter (single unit; absent = all units).
  const unitParam = parseInt(url.searchParams.get('topLevelUnitId') || '', 10)
  const topLevelUnitId = Number.isInteger(unitParam) && unitParam > 0 ? unitParam : undefined

  const result = await computeTeacherWorkloadsPaginated(where, {
    sort,
    page,
    pageSize,
    search,
    topLevelUnitId,
  })

  // Hour units for the rating table: astronomical (default) or academic.
  // Academic: 90 astronomical minutes = 120 academic minutes, i.e. ×4/3.
  // Converted from raw minutes in a single rounding — not from the already
  // rounded astronomical hours — so the numbers stay exact for HR reports.
  // The ×4/3 factor is monotonic, so the server-side ranking (by minutes)
  // is identical in both modes.
  const factor = url.searchParams.get('hours') === 'academic' ? 4 / 3 : 1

  return NextResponse.json({
    sort,
    search,
    page: result.page,
    pageSize: result.pageSize,
    total: result.total,
    totalPages: result.totalPages,
    items: result.items.map((t) => ({
      id: t.id,
      name: t.displayName,
      longName: t.longName,
      eventsCount: t.eventsCount,
      scheduledHours: roundHours(t.scheduledMinutes * factor),
      effectiveHours: roundHours(t.effectiveMinutes * factor),
      simultaneousEvents: t.simultaneousEvents,
      simultaneousGroups: t.simultaneousGroups,
      simultaneousTimeSavedHours: roundHours((t.scheduledMinutes - t.effectiveMinutes) * factor),
      inferredEndEvents: t.inferredEndEvents,
      canceledEvents: t.canceledEvents,
    })),
  })
}
