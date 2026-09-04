import { NextResponse } from 'next/server'
import {
  buildEventWhere,
  computeRoomWorkloadsPaginated,
  type CommonFilters,
  type RoomSortKey,
} from '@/lib/analytics'

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

  const sort = (url.searchParams.get('sort') as RoomSortKey) || 'hours'
  const search = url.searchParams.get('search') || ''
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10))
  const pageSize = Math.max(1, Math.min(500, parseInt(url.searchParams.get('pageSize') || '50', 10)))

  const result = await computeRoomWorkloadsPaginated(where, { sort, page, pageSize, search })

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
