import { NextResponse } from 'next/server'
import {
  buildEventWhere,
  parseCommonFilters,
  computeTeacherWorkloadsPaginated,
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
      scheduledHours: Math.round((t.scheduledMinutes / 60) * 10) / 10,
      effectiveHours: Math.round((t.effectiveMinutes / 60) * 10) / 10,
      simultaneousEvents: t.simultaneousEvents,
      simultaneousGroups: t.simultaneousGroups,
      simultaneousTimeSavedHours:
        Math.round(((t.scheduledMinutes - t.effectiveMinutes) / 60) * 10) / 10,
      inferredEndEvents: t.inferredEndEvents,
      canceledEvents: t.canceledEvents,
    })),
  })
}
