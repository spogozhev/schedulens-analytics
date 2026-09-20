import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { buildEventWhere, dayName, hourOf, type CommonFilters } from '@/lib/analytics'

export const dynamic = 'force-dynamic'

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: idStr } = await ctx.params
  const id = parseInt(idStr, 10)
  if (Number.isNaN(id)) return NextResponse.json({ error: 'Bad id' }, { status: 400 })

  const url = new URL(request.url)
  const filters: CommonFilters = {
    dateRangeIds: url.searchParams.get('dateRangeIds'),
    kindCode: url.searchParams.get('kindCode'),
    includeCanceled: url.searchParams.get('includeCanceled') ?? 'false',
  }
  const where = buildEventWhere(filters)

  const teacher = await db.educator.findUnique({
    where: { id },
    include: {
      employments: {
        select: { position: true, department: { select: { name: true } } },
        orderBy: [{ department: { name: 'asc' } }, { position: 'asc' }],
      },
      events: {
        where,
        select: {
          id: true,
          startDateTime: true,
          endDateTime: true,
          durationMinutes: true,
          simultaneousGroupId: true,
          hasInferredEnd: true,
          isCanceled: true,
          kindCode: true,
          dayOfWeek: true,
          dateStr: true,
          rawStart: true,
          rawEnd: true,
          lectureHash: true,
          subject: { select: { name: true } },
          locations: { include: { location: { select: { displayName: true } } } },
          groups: { include: { group: { select: { name: true } } } },
        },
        orderBy: { startDateTime: 'asc' },
      },
    },
  })
  if (!teacher) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const events = teacher.events
  const scheduledMinutes = events.reduce((s, e) => s + e.durationMinutes, 0)

  // Derive co-teachers from `lectureHash` — every ScheduleEvent with the
  // same lectureHash and a DIFFERENT educatorId (> 0, i.e. a real teacher
  // not a co-teacher placeholder) is a co-teacher of this event.
  // We collect the lectureHashes of the recent 100 events (the ones we'll
  // return in `recentEvents`) and do a single query.
  const recentEventsRaw = events.slice(-100).reverse()
  const recentLectureHashes = [...new Set(recentEventsRaw.map((e) => e.lectureHash))]
  const coTeacherRows = recentLectureHashes.length > 0
    ? await db.scheduleEvent.findMany({
        where: {
          lectureHash: { in: recentLectureHashes },
          educatorId: { gt: 0, not: id },
        },
        select: {
          lectureHash: true,
          educator: { select: { displayName: true, longName: true } },
        },
      })
    : []
  // Build map: lectureHash → Set of co-teacher display names
  const coTeachersByHash = new Map<string, string[]>()
  for (const row of coTeacherRows) {
    const arr = coTeachersByHash.get(row.lectureHash) ?? []
    if (!arr.includes(row.educator.displayName)) arr.push(row.educator.displayName)
    coTeachersByHash.set(row.lectureHash, arr)
  }

  // Effective minutes (dedupe by simultaneous group).
  const groups = new Map<string, { start: number; end: number; events: typeof events }>()
  for (const e of events) {
    const k = e.simultaneousGroupId ?? `single-${e.id}`
    const s = e.startDateTime.getTime()
    const en = e.endDateTime.getTime()
    if (!groups.has(k)) groups.set(k, { start: s, end: en, events: [] })
    const g = groups.get(k)!
    g.start = Math.min(g.start, s)
    g.end = Math.max(g.end, en)
    g.events.push(e)
  }
  let effectiveMinutes = 0
  for (const [, g] of groups) effectiveMinutes += (g.end - g.start) / 60_000

  const simGroups = [...groups.values()].filter((g) => g.events.length > 1).sort((a, b) => a.start - b.start)
  const simultaneousEventsCount = events.filter((e) => e.simultaneousGroupId).length

  // By week (timeline)
  const byWeek = new Map<string, { events: number; minutes: number }>()
  for (const e of events) {
    // ISO week
    const date = new Date(Date.UTC(e.startDateTime.getUTCFullYear(), e.startDateTime.getUTCMonth(), e.startDateTime.getUTCDate()))
    const dayNum = (date.getUTCDay() + 6) % 7
    date.setUTCDate(date.getUTCDate() - dayNum + 3)
    const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4))
    const week = 1 + Math.round(
      ((date.getTime() - firstThursday.getTime()) / 86_400_000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7,
    )
    const year = date.getUTCFullYear()
    const key = `${year}-W${String(week).padStart(2, '0')}`
    if (!byWeek.has(key)) byWeek.set(key, { events: 0, minutes: 0 })
    byWeek.get(key)!.events++
    byWeek.get(key)!.minutes += e.durationMinutes
  }

  // By day-of-week
  const byDay = Array.from({ length: 7 }, (_, i) => ({ day: i + 1, dayName: dayName(i + 1), events: 0, minutes: 0 }))
  for (const e of events) {
    byDay[e.dayOfWeek - 1].events++
    byDay[e.dayOfWeek - 1].minutes += e.durationMinutes
  }

  // By hour
  const byHour = Array.from({ length: 24 }, (_, h) => ({ hour: h, events: 0, minutes: 0 }))
  for (const e of events) {
    byHour[hourOf(e.startDateTime)].events++
    byHour[hourOf(e.startDateTime)].minutes += e.durationMinutes
  }

  // By subject (top 10)
  const bySubjectMap = new Map<string, { events: number; minutes: number }>()
  for (const e of events) {
    const name = e.subject.name
    if (!bySubjectMap.has(name)) bySubjectMap.set(name, { events: 0, minutes: 0 })
    bySubjectMap.get(name)!.events++
    bySubjectMap.get(name)!.minutes += e.durationMinutes
  }
  const bySubject = [...bySubjectMap.entries()]
    .map(([name, v]) => ({ subject: name, events: v.events, hours: Math.round((v.minutes / 60) * 10) / 10 }))
    .sort((a, b) => b.hours - a.hours)
    .slice(0, 10)

  // By kind code
  const byKindMap = new Map<number, number>()
  for (const e of events) byKindMap.set(e.kindCode, (byKindMap.get(e.kindCode) ?? 0) + 1)

  // Recent events (max 100) — derive co-teachers from the lectureHash map
  const recentEvents = recentEventsRaw.map((e) => ({
    id: e.id,
    start: e.startDateTime.toISOString(),
    end: e.endDateTime.toISOString(),
    rawStart: e.rawStart,
    rawEnd: e.rawEnd,
    hasInferredEnd: e.hasInferredEnd,
    durationMinutes: e.durationMinutes,
    subject: e.subject.name,
    kindCode: e.kindCode,
    dayOfWeek: e.dayOfWeek,
    dateStr: e.dateStr,
    isCanceled: e.isCanceled,
    simultaneousGroupId: e.simultaneousGroupId,
    locations: e.locations.map((l) => l.location.displayName),
    groups: e.groups.map((g) => g.group.name),
    coEducators: coTeachersByHash.get(e.lectureHash) ?? [],
  }))

  // Sample simultaneous groups (max 30)
  const simultaneousGroupSamples = simGroups.slice(0, 30).map((g, i) => ({
    id: `sim-${i}`,
    start: new Date(g.start).toISOString(),
    end: new Date(g.end).toISOString(),
    effectiveMinutes: Math.round((g.end - g.start) / 60_000),
    events: g.events.map((e) => ({
      id: e.id,
      start: e.startDateTime.toISOString(),
      end: e.endDateTime.toISOString(),
      subject: e.subject.name,
      locations: e.locations.map((l) => l.location.displayName),
      groups: e.groups.map((gg) => gg.group.name),
    })),
  }))

  return NextResponse.json({
    id: teacher.id,
    displayName: teacher.displayName,
    longName: teacher.longName,
    // Flat strings for the UI; department is null when the staff export had none.
    employments: teacher.employments.map((e) => ({
      position: e.position,
      department: e.department?.name ?? null,
    })),
    kpis: {
      eventsCount: events.length,
      scheduledHours: Math.round((scheduledMinutes / 60) * 10) / 10,
      effectiveHours: Math.round((effectiveMinutes / 60) * 10) / 10,
      simultaneousEvents: simultaneousEventsCount,
      simultaneousGroups: simGroups.length,
      timeSavedHours: Math.round(((scheduledMinutes - effectiveMinutes) / 60) * 10) / 10,
      inferredEndEvents: events.filter((e) => e.hasInferredEnd).length,
      canceledEvents: events.filter((e) => e.isCanceled).length,
    },
    byWeek: [...byWeek.entries()].map(([k, v]) => ({ week: k, events: v.events, minutes: v.minutes })).sort((a, b) =>
      a.week < b.week ? -1 : 1,
    ),
    byDayOfWeek: byDay,
    byHour,
    bySubject,
    byKind: [...byKindMap.entries()].map(([kind, count]) => ({ kindCode: kind, count })),
    recentEvents,
    simultaneousGroups: simultaneousGroupSamples,
  })
}
