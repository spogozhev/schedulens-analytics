import { NextResponse } from 'next/server'
import {
  buildEventWhere,
  computeRoomWorkloads,
  parseCommonFilters,
  roundHours,
} from '@/lib/analytics'

export const dynamic = 'force-dynamic'

/**
 * Top-N rooms by total booked hours (default N=10, `limit` query param,
 * clamped to 1..50). Only rooms with events in the filter period are
 * computed.
 */
export async function GET(request: Request) {
  const url = new URL(request.url)
  const where = buildEventWhere(parseCommonFilters(url))
  const limitParam = Number(url.searchParams.get('limit')) || 10
  const limit = Math.min(Math.max(limitParam, 1), 50)

  const rooms = await computeRoomWorkloads(where).then((ws) =>
    ws.sort((a, b) => b.totalMinutes - a.totalMinutes).slice(0, limit),
  )

  return NextResponse.json({
    topRooms: rooms.map((r) => ({
      id: r.id,
      name: r.displayName,
      events: r.eventsCount,
      uniqueLectures: r.uniqueLectures,
      hours: roundHours(r.totalMinutes),
      conflicts: r.conflicts,
    })),
  })
}
