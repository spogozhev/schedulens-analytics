import { NextResponse } from 'next/server'
import {
  buildEventWhere,
  parseCommonFilters,
  parseIdList,
  computeRoomWorkloadsPaginated,
  type RoomSortKey,
} from '@/lib/analytics'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const filters = parseCommonFilters(url)
  const where = buildEventWhere(filters)

  const sort = (url.searchParams.get('sort') as RoomSortKey) || 'hours'
  const search = url.searchParams.get('search') || ''
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10))
  const pageSize = Math.max(1, Math.min(500, parseInt(url.searchParams.get('pageSize') || '50', 10)))

  const result = await computeRoomWorkloadsPaginated(where, {
    sort,
    page,
    pageSize,
    search,
    addressIds: parseIdList(url.searchParams.get('addressIds')),
  })

  return NextResponse.json({
    sort,
    search,
    page: result.page,
    pageSize: result.pageSize,
    total: result.total,
    totalPages: result.totalPages,
    items: result.items.map((r) => ({
      id: r.id,
      name: r.displayName,
      eventsCount: r.eventsCount,
      uniqueLectures: r.uniqueLectures,
      hours: Math.round((r.totalMinutes / 60) * 10) / 10,
      conflicts: r.conflicts,
      latitude: r.latitude,
      longitude: r.longitude,
    })),
  })
}
