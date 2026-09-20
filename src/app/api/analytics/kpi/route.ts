import { NextResponse } from 'next/server'
import {
  buildEventWhere,
  computeOverviewKpis,
  parseCommonFilters,
  roundHours,
} from '@/lib/analytics'

export const dynamic = 'force-dynamic'

/**
 * KPI totals for the dashboard header cards and the simultaneous-classes
 * banner. Aggregations run in SQL via `computeOverviewKpis`, so the full
 * per-teacher workloads are never loaded here.
 */
export async function GET(request: Request) {
  const url = new URL(request.url)
  const where = buildEventWhere(parseCommonFilters(url))

  const kpis = await computeOverviewKpis(where)

  return NextResponse.json({
    kpis: {
      teachers: kpis.teachersCount,
      events: kpis.eventsCount,
      rooms: kpis.roomsCount,
      subjects: kpis.subjectsCount,
      groups: kpis.groupsCount,
      scheduledHours: roundHours(kpis.scheduledMinutes),
      effectiveHours: roundHours(kpis.effectiveMinutes),
      simultaneousEvents: kpis.simultaneousEvents,
      simultaneousGroups: kpis.simultaneousGroups,
      inferredEndEvents: kpis.inferredEndEvents,
      timeSavedHours: roundHours(kpis.scheduledMinutes - kpis.effectiveMinutes),
    },
  })
}
