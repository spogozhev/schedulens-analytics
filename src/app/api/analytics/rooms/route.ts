import { NextResponse } from 'next/server'
import { buildEventWhere, computeRoomWorkloads, type CommonFilters } from '@/lib/analytics'

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

  const rooms = await computeRoomWorkloads(where)

  const sort = url.searchParams.get('sort') || 'hours'
  const topN = parseInt(url.searchParams.get('top') || '50', 10)

  const sorted = [...rooms].sort((a, b) => {
    switch (sort) {
      case 'events':
        return b.eventsCount - a.eventsCount
      case 'uniqueLectures':
        return b.uniqueLectures - a.uniqueLectures
      case 'conflicts':
        return b.conflicts - a.conflicts
      case 'name':
        return a.displayName.localeCompare(b.displayName, 'ru')
      case 'hours':
      default:
        return b.totalMinutes - a.totalMinutes
    }
  })

  const limited = topN > 0 ? sorted.slice(0, topN) : sorted

  return NextResponse.json({
    sort,
    items: limited.map((r) => ({
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
