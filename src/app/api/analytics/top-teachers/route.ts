import { NextResponse } from 'next/server'
import {
  buildEventWhere,
  computeTeacherWorkloads,
  parseCommonFilters,
  roundHours,
} from '@/lib/analytics'

export const dynamic = 'force-dynamic'

/**
 * Top-N teachers by effective load (default N=10, `limit` query param,
 * clamped to 1..50). Only teachers with events in the filter period are
 * computed — the key optimization for 5000+ teacher rosters.
 */
export async function GET(request: Request) {
  const url = new URL(request.url)
  const where = buildEventWhere(parseCommonFilters(url))
  const limitParam = Number(url.searchParams.get('limit')) || 10
  const limit = Math.min(Math.max(limitParam, 1), 50)

  const teachers = await computeTeacherWorkloads(where).then((ws) =>
    ws.sort((a, b) => b.effectiveMinutes - a.effectiveMinutes).slice(0, limit),
  )

  return NextResponse.json({
    topTeachers: teachers.map((t) => ({
      id: t.id,
      name: t.displayName,
      longName: t.longName,
      events: t.eventsCount,
      scheduledHours: roundHours(t.scheduledMinutes),
      effectiveHours: roundHours(t.effectiveMinutes),
      simultaneousGroups: t.simultaneousGroups,
    })),
  })
}
