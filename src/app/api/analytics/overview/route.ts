import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  buildEventWhere,
  computeTeacherWorkloads,
  computeRoomWorkloads,
  computeTimeline,
  getDateBounds,
  KIND_LABELS,
  type CommonFilters,
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

  const bounds = await getDateBounds()

  const [teachers, rooms, kindAgg, eventsCount, simAgg, inferredAgg, timeline, allEducators, allRooms] =
    await Promise.all([
      computeTeacherWorkloads(where),
      computeRoomWorkloads(where),
      db.scheduleEvent.groupBy({ by: ['kindCode'], where, _count: { _all: true } }),
      db.scheduleEvent.count({ where }),
      db.scheduleEvent.count({ where: { ...where, simultaneousGroupId: { not: null } } }),
      db.scheduleEvent.count({ where: { ...where, hasInferredEnd: true } }),
      computeTimeline(where, 'week'),
      db.educator.findMany({
        where: { id: { gt: 0 } },
        select: { id: true, displayName: true, longName: true },
        orderBy: { displayName: 'asc' },
      }),
      db.location.findMany({ select: { id: true, displayName: true }, orderBy: { displayName: 'asc' } }),
    ])

  // KPIs
  const totalScheduledMinutes = teachers.reduce((s, t) => s + t.scheduledMinutes, 0)
  const totalEffectiveMinutes = teachers.reduce((s, t) => s + t.effectiveMinutes, 0)
  const totalSimultaneousEvents = simAgg
  const simGroupIds = new Set<string>()
  const simEvents = await db.scheduleEvent.findMany({
    where: { ...where, simultaneousGroupId: { not: null } },
    select: { simultaneousGroupId: true },
    distinct: ['simultaneousGroupId'],
  })
  for (const e of simEvents) if (e.simultaneousGroupId) simGroupIds.add(e.simultaneousGroupId)

  const teachersRanked = [...teachers].sort((a, b) => b.effectiveMinutes - a.effectiveMinutes).slice(0, 5)
  const roomsRanked = [...rooms].sort((a, b) => b.totalMinutes - a.totalMinutes).slice(0, 5)

  const byKind = kindAgg.map((k) => ({
    kindCode: k.kindCode,
    label: KIND_LABELS[k.kindCode] ?? `Тип ${k.kindCode}`,
    count: k._count._all,
  }))

  return NextResponse.json({
    dateBounds: bounds
      ? { from: bounds.from.toISOString(), to: bounds.to.toISOString() }
      : null,
    kpis: {
      teachers: teachers.filter((t) => t.eventsCount > 0).length,
      events: eventsCount,
      rooms: rooms.filter((r) => r.eventsCount > 0).length,
      subjects: await db.subject.count(),
      groups: await db.group.count(),
      scheduledHours: Math.round((totalScheduledMinutes / 60) * 10) / 10,
      effectiveHours: Math.round((totalEffectiveMinutes / 60) * 10) / 10,
      simultaneousEvents: totalSimultaneousEvents,
      simultaneousGroups: simGroupIds.size,
      inferredEndEvents: inferredAgg,
      timeSavedHours: Math.round(((totalScheduledMinutes - totalEffectiveMinutes) / 60) * 10) / 10,
    },
    byKind,
    timeline,
    topTeachers: teachersRanked.map((t) => ({
      id: t.id,
      name: t.displayName,
      longName: t.longName,
      events: t.eventsCount,
      scheduledHours: Math.round((t.scheduledMinutes / 60) * 10) / 10,
      effectiveHours: Math.round((t.effectiveMinutes / 60) * 10) / 10,
      simultaneousGroups: t.simultaneousGroups,
    })),
    topRooms: roomsRanked.map((r) => ({
      id: r.id,
      name: r.displayName,
      events: r.eventsCount,
      uniqueLectures: r.uniqueLectures,
      hours: Math.round((r.totalMinutes / 60) * 10) / 10,
      conflicts: r.conflicts,
    })),
    filterOptions: {
      educators: allEducators.map((e) => ({ id: e.id, name: e.displayName, longName: e.longName })),
      rooms: allRooms.map((r) => ({ id: r.id, name: r.displayName })),
      kinds: Object.entries(KIND_LABELS).map(([code, label]) => ({ kindCode: Number(code), label })),
    },
  })
}
