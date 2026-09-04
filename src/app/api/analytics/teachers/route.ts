import { NextResponse } from 'next/server'
import { buildEventWhere, computeTeacherWorkloads, type CommonFilters } from '@/lib/analytics'

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

  const teachers = await computeTeacherWorkloads(where)

  const sort = url.searchParams.get('sort') || 'effectiveHours'
  const topN = parseInt(url.searchParams.get('top') || '50', 10)

  const sorted = [...teachers].sort((a, b) => {
    switch (sort) {
      case 'scheduledHours':
        return b.scheduledMinutes - a.scheduledMinutes
      case 'eventsCount':
        return b.eventsCount - a.eventsCount
      case 'simultaneousGroups':
        return b.simultaneousGroups - a.simultaneousGroups
      case 'simultaneousEvents':
        return b.simultaneousEvents - a.simultaneousEvents
      case 'name':
        return a.displayName.localeCompare(b.displayName, 'ru')
      case 'effectiveHours':
      default:
        return b.effectiveMinutes - a.effectiveMinutes
    }
  })

  const limited = topN > 0 ? sorted.slice(0, topN) : sorted

  return NextResponse.json({
    sort,
    items: limited.map((t) => ({
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
