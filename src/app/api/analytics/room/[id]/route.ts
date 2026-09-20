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

  const eventSelect = {
    id: true,
    startDateTime: true,
    endDateTime: true,
    durationMinutes: true,
    lectureHash: true,
    dayOfWeek: true,
    kindCode: true,
    isCanceled: true,
    subject: { select: { name: true } },
    educator: { select: { id: true, displayName: true, longName: true } },
    groups: { include: { group: { select: { name: true } } } },
  } as const

  // Events of this room come from two places (see schema): the denormalized
  // primary location on the event, and the additional-location links.
  // An event lands in exactly one of the two lists for a given room.
  const [room, primaryEvents, extraEvents] = await Promise.all([
    db.location.findUnique({ where: { id } }),
    db.scheduleEvent.findMany({ where: { ...where, locationId: id }, select: eventSelect }),
    db.scheduleEvent.findMany({
      where: { ...where, locations: { some: { locationId: id } } },
      select: eventSelect,
    }),
  ])
  if (!room) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const allEvents = [...primaryEvents, ...extraEvents]

  // Dedupe by lectureHash — each physical lecture is one utilization slot.
  // (Multiple rows for the same physical lecture differ only by audience
  //  group, so lectureHash merges them.)
  const seen = new Set<string>()
  const lectures: {
    id: string
    hash: string
    start: Date
    end: Date
    minutes: number
    subject: string
    dayOfWeek: number
    kindCode: number
    isCanceled: boolean
    educatorId: number
    educatorName: string
    educatorLongName: string
    groups: string[]
  }[] = []
  for (const ev of allEvents) {
    if (seen.has(ev.lectureHash)) continue
    seen.add(ev.lectureHash)
    lectures.push({
      id: ev.id,
      hash: ev.lectureHash,
      start: ev.startDateTime,
      end: ev.endDateTime,
      minutes: ev.durationMinutes,
      subject: ev.subject.name,
      dayOfWeek: ev.dayOfWeek,
      kindCode: ev.kindCode,
      isCanceled: ev.isCanceled,
      educatorId: ev.educator.id,
      educatorName: ev.educator.displayName,
      educatorLongName: ev.educator.longName,
      groups: ev.groups.map((g) => g.group.name),
    })
  }
  lectures.sort((a, b) => a.start.getTime() - b.start.getTime())

  // Derive co-teachers from `lectureHash` — for each lecture, find other
  // ScheduleEvent rows with the same lectureHash and a different educatorId
  // (> 0). One query covers all lectures.
  const allLectureHashes = lectures.map((l) => l.hash)
  const coTeacherRows = allLectureHashes.length > 0
    ? await db.scheduleEvent.findMany({
        where: {
          lectureHash: { in: allLectureHashes },
          educatorId: { gt: 0 },
        },
        select: {
          lectureHash: true,
          educatorId: true,
          educator: { select: { displayName: true } },
        },
      })
    : []
  // Build map: lectureHash → Map(educatorId → displayName) — all teachers
  // (including the primary) who deliver this physical lecture.
  const educatorsByHash = new Map<string, Map<number, string>>()
  for (const row of coTeacherRows) {
    if (!educatorsByHash.has(row.lectureHash)) educatorsByHash.set(row.lectureHash, new Map())
    educatorsByHash.get(row.lectureHash)!.set(row.educatorId, row.educator.displayName)
  }

  const totalMinutes = lectures.reduce((s, l) => s + l.minutes, 0)
  const eventsCount = allEvents.length

  // Conflicts: overlapping intervals, different hashes.
  // NOTE: back-to-back lectures (a.end === b.start) are NOT a conflict —
  // we use `>=` so that b.start === a.end triggers the break.
  const sortedForConflict = [...lectures].sort((a, b) => a.start.getTime() - b.start.getTime())
  let conflicts = 0
  for (let i = 0; i < sortedForConflict.length; i++) {
    for (let j = i + 1; j < sortedForConflict.length; j++) {
      const a = sortedForConflict[i]
      const b = sortedForConflict[j]
      if (b.start.getTime() >= a.end.getTime()) break
      conflicts++
    }
  }

  // By day-of-week
  const byDay = Array.from({ length: 7 }, (_, i) => ({ day: i + 1, dayName: dayName(i + 1), events: 0, minutes: 0 }))
  for (const l of lectures) {
    byDay[l.dayOfWeek - 1].events++
    byDay[l.dayOfWeek - 1].minutes += l.minutes
  }

  // By hour
  const byHour = Array.from({ length: 24 }, (_, h) => ({ hour: h, events: 0, minutes: 0 }))
  for (const l of lectures) {
    byHour[hourOf(l.start)].events++
    byHour[hourOf(l.start)].minutes += l.minutes
  }

  // By subject
  const bySubjectMap = new Map<string, { events: number; minutes: number }>()
  for (const l of lectures) {
    if (!bySubjectMap.has(l.subject)) bySubjectMap.set(l.subject, { events: 0, minutes: 0 })
    bySubjectMap.get(l.subject)!.events++
    bySubjectMap.get(l.subject)!.minutes += l.minutes
  }
  const bySubject = [...bySubjectMap.entries()]
    .map(([s, v]) => ({ subject: s, events: v.events, hours: Math.round((v.minutes / 60) * 10) / 10 }))
    .sort((a, b) => b.hours - a.hours)
    .slice(0, 10)

  // By educator (top 10)
  const byEducatorMap = new Map<string, { events: number; minutes: number }>()
  for (const l of lectures) {
    const key = l.educatorName
    if (!byEducatorMap.has(key)) byEducatorMap.set(key, { events: 0, minutes: 0 })
    byEducatorMap.get(key)!.events++
    byEducatorMap.get(key)!.minutes += l.minutes
  }
  const byEducator = [...byEducatorMap.entries()]
    .map(([n, v]) => ({ educator: n, events: v.events, hours: Math.round((v.minutes / 60) * 10) / 10 }))
    .sort((a, b) => b.hours - a.hours)
    .slice(0, 10)

  // Recent events (latest 100) — derive co-teachers from the educatorsByHash
  // map (all teachers with the same lectureHash minus the primary educator).
  const recentEvents = [...lectures].slice(-100).reverse().map((l) => {
    const allEducators = educatorsByHash.get(l.hash)
    const coEducators: string[] = []
    if (allEducators) {
      for (const [educatorId, name] of allEducators) {
        if (educatorId !== l.educatorId && !coEducators.includes(name)) {
          coEducators.push(name)
        }
      }
    }
    return {
      id: l.id,
      start: l.start.toISOString(),
      end: l.end.toISOString(),
      durationMinutes: l.minutes,
      subject: l.subject,
      kindCode: l.kindCode,
      dayOfWeek: l.dayOfWeek,
      dayName: dayName(l.dayOfWeek),
      isCanceled: l.isCanceled,
      educatorId: l.educatorId,
      educatorName: l.educatorName,
      educatorLongName: l.educatorLongName,
      groups: l.groups,
      coEducators,
    }
  })

  return NextResponse.json({
    id: room.id,
    name: room.displayName,
    latitude: room.latitude,
    longitude: room.longitude,
    kpis: {
      eventsCount,
      uniqueLectures: lectures.length,
      hours: Math.round((totalMinutes / 60) * 10) / 10,
      conflicts,
      canceledLectures: lectures.filter((l) => l.isCanceled).length,
    },
    byDayOfWeek: byDay,
    byHour,
    bySubject,
    byEducator,
    recentEvents,
  })
}
