import { db } from '@/lib/db'
import type { Prisma } from '@prisma/client'

// Maps kindCode to a human-readable Russian label.
export const KIND_LABELS: Record<number, string> = {
  0: 'Индивидуальные мероприятия',
  1: 'Регулярные занятия',
  2: 'Сессия / консультации',
}

export interface DateRange {
  from: Date | null
  to: Date | null
}

export interface CommonFilters {
  from?: string | null
  to?: string | null
  kindCode?: string | null
  includeCanceled?: string | null
}

/** Build a Prisma where-clause fragment for ScheduleEvent based on common filters. */
export function buildEventWhere(filters: CommonFilters): Prisma.ScheduleEventWhereInput {
  const where: Prisma.ScheduleEventWhereInput = {}
  if (filters.from || filters.to) {
    where.startDateTime = {}
    if (filters.from) where.startDateTime.gte = new Date(filters.from)
    if (filters.to) where.startDateTime.lte = new Date(filters.to)
  }
  if (filters.kindCode && filters.kindCode !== 'all') {
    const n = Number(filters.kindCode)
    if (!Number.isNaN(n)) where.kindCode = n
  }
  if (filters.includeCanceled !== 'true') {
    where.isCanceled = false
  }
  return where
}

/** Compute (minStart, maxEnd) for the dataset to scope defaults. */
export async function getDateBounds(): Promise<{ from: Date; to: Date } | null> {
  const agg = await db.scheduleEvent.aggregate({ _min: { startDateTime: true }, _max: { endDateTime: true } })
  if (!agg._min.startDateTime || !agg._max.endDateTime) return null
  return { from: agg._min.startDateTime, to: agg._max.endDateTime }
}

export interface TeacherWorkload {
  id: number
  displayName: string
  longName: string
  eventsCount: number
  scheduledMinutes: number
  effectiveMinutes: number
  simultaneousEvents: number
  simultaneousGroups: number
  inferredEndEvents: number
  canceledEvents: number
}

/**
 * Compute per-teacher workload, accounting for simultaneous events.
 *
 * - For each teacher, we group their events by overlapping time (the same
 *   logic used at import time, but re-derived here from `simultaneousGroupId`).
 * - `effectiveMinutes` is the union of the time intervals actually spent
 *   teaching (simultaneous events counted once).
 */
export async function computeTeacherWorkloads(
  where: Prisma.ScheduleEventWhereInput,
): Promise<TeacherWorkload[]> {
  // Pull all primary educators (id > 0).
  const teachers = await db.educator.findMany({
    where: { id: { gt: 0 } },
    select: {
      id: true,
      displayName: true,
      longName: true,
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
        },
      },
    },
  })

  const result: TeacherWorkload[] = []
  for (const t of teachers) {
    if (t.events.length === 0) {
      result.push({
        id: t.id,
        displayName: t.displayName,
        longName: t.longName,
        eventsCount: 0,
        scheduledMinutes: 0,
        effectiveMinutes: 0,
        simultaneousEvents: 0,
        simultaneousGroups: 0,
        inferredEndEvents: 0,
        canceledEvents: 0,
      })
      continue
    }
    const scheduledMinutes = t.events.reduce((s, e) => s + e.durationMinutes, 0)
    const simGroupIds = new Set<string>()
    let simultaneousEvents = 0
    let inferredEndEvents = 0
    let canceledEvents = 0

    // Group by simultaneousGroupId (or singleton by event id).
    const groups = new Map<string, typeof t.events>()
    for (const e of t.events) {
      const k = e.simultaneousGroupId ?? `single-${e.id}`
      if (!groups.has(k)) groups.set(k, [])
      groups.get(k)!.push(e)
      if (e.simultaneousGroupId) {
        simGroupIds.add(e.simultaneousGroupId)
        simultaneousEvents++
      }
      if (e.hasInferredEnd) inferredEndEvents++
      if (e.isCanceled) canceledEvents++
    }

    let effectiveMinutes = 0
    for (const [, evs] of groups) {
      const minStart = Math.min(...evs.map((e) => e.startDateTime.getTime()))
      const maxEnd = Math.max(...evs.map((e) => e.endDateTime.getTime()))
      effectiveMinutes += (maxEnd - minStart) / 60_000
    }

    result.push({
      id: t.id,
      displayName: t.displayName,
      longName: t.longName,
      eventsCount: t.events.length,
      scheduledMinutes: Math.round(scheduledMinutes),
      effectiveMinutes: Math.round(effectiveMinutes),
      simultaneousEvents,
      simultaneousGroups: simGroupIds.size,
      inferredEndEvents,
      canceledEvents,
    })
  }
  return result
}

export interface RoomWorkload {
  id: number
  displayName: string
  eventsCount: number
  uniqueLectures: number
  totalMinutes: number
  conflicts: number
  latitude: number | null
  longitude: number | null
}

/**
 * Compute per-room workload. Multiple teacher rows for the same physical
 * lecture (same `lectureHash`) are counted once for utilization.
 *
 * `conflicts` is the count of times a room was double-booked (overlapping
 * intervals belonging to *different* physical lectures).
 */
export async function computeRoomWorkloads(
  where: Prisma.ScheduleEventWhereInput,
): Promise<RoomWorkload[]> {
  const locations = await db.location.findMany({
    include: {
      events: {
        where: { event: where },
        select: {
          event: {
            select: {
              id: true,
              startDateTime: true,
              endDateTime: true,
              durationMinutes: true,
              lectureHash: true,
            },
          },
        },
      },
    },
  })

  const result: RoomWorkload[] = []
  for (const l of locations) {
    if (l.events.length === 0) {
      result.push({
        id: l.id,
        displayName: l.displayName,
        eventsCount: 0,
        uniqueLectures: 0,
        totalMinutes: 0,
        conflicts: 0,
        latitude: l.latitude,
        longitude: l.longitude,
      })
      continue
    }
    // Dedupe by lectureHash → unique physical lectures.
    // (Multiple rows for the same physical lecture differ only by audience
    //  group, so lectureHash merges them.)
    const seen = new Set<string>()
    let totalMinutes = 0
    const lectures: { start: number; end: number; hash: string }[] = []
    for (const le of l.events) {
      const ev = le.event
      lectures.push({ start: ev.startDateTime.getTime(), end: ev.endDateTime.getTime(), hash: ev.lectureHash })
      if (!seen.has(ev.lectureHash)) {
        seen.add(ev.lectureHash)
        totalMinutes += ev.durationMinutes
      }
    }
    // Detect conflicts: same room, overlapping intervals, DIFFERENT lectureHash.
    lectures.sort((a, b) => a.start - b.start)
    let conflicts = 0
    for (let i = 0; i < lectures.length; i++) {
      for (let j = i + 1; j < lectures.length; j++) {
        const a = lectures[i]
        const b = lectures[j]
        if (b.start >= a.end) break // sorted, no further overlap
        if (a.hash !== b.hash) conflicts++
      }
    }
    result.push({
      id: l.id,
      displayName: l.displayName,
      eventsCount: lectures.length,
      uniqueLectures: seen.size,
      totalMinutes,
      conflicts,
      latitude: l.latitude,
      longitude: l.longitude,
    })
  }
  return result
}

/** Build a YYYY-ISO-week string from a Date. */
export function isoWeek(d: Date): { year: number; week: number; label: string } {
  // ISO week: Thursday determines the week's year.
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  const dayNum = (date.getUTCDay() + 6) % 7 // 0=Mon
  date.setUTCDate(date.getUTCDate() - dayNum + 3) // Thursday of this week
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4))
  const week = 1 + Math.round(((date.getTime() - firstThursday.getTime()) / 86_400_000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7)
  const year = date.getUTCFullYear()
  return { year, week, label: `${year}-W${String(week).padStart(2, '0')}` }
}

/** Build a "YYYY-MM-DD" key from a Date. */
export function dayKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

/** Hours from a Date (UTC). */
export function hourOf(d: Date): number {
  return d.getUTCHours()
}

const DAY_NAMES_RU = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье']
export function dayName(dow1to7: number): string {
  return DAY_NAMES_RU[(dow1to7 - 1 + 7) % 7]
}

/** Aggregate events into buckets (by day or week) — used for timeline charts. */
export interface TimelineBucket {
  key: string
  date: string
  events: number
  scheduledMinutes: number
  effectiveMinutes: number
}

export async function computeTimeline(
  where: Prisma.ScheduleEventWhereInput,
  granularity: 'day' | 'week' = 'week',
): Promise<TimelineBucket[]> {
  const events = await db.scheduleEvent.findMany({
    where,
    select: { startDateTime: true, endDateTime: true, durationMinutes: true, simultaneousGroupId: true, id: true, educatorId: true },
    orderBy: { startDateTime: 'asc' },
  })
  // Group by bucket key
  const byBucket = new Map<string, typeof events>()
  for (const e of events) {
    const key = granularity === 'day' ? dayKey(e.startDateTime) : isoWeek(e.startDateTime).label
    if (!byBucket.has(key)) byBucket.set(key, [])
    byBucket.get(key)!.push(e)
  }
  // Within each bucket, also dedupe by simultaneous group per teacher.
  const out: TimelineBucket[] = []
  for (const [key, evs] of byBucket) {
    const simGroups = new Map<string, { start: number; end: number }>()
    const singletons: { start: number; end: number }[] = []
    for (const e of evs) {
      const k = e.simultaneousGroupId ?? `single-${e.id}`
      const start = e.startDateTime.getTime()
      const end = e.endDateTime.getTime()
      if (e.simultaneousGroupId) {
        if (!simGroups.has(k)) simGroups.set(k, { start, end })
        else {
          const cur = simGroups.get(k)!
          cur.start = Math.min(cur.start, start)
          cur.end = Math.max(cur.end, end)
        }
      } else {
        singletons.push({ start, end })
      }
    }
    let effectiveMinutes = 0
    for (const [, g] of simGroups) effectiveMinutes += (g.end - g.start) / 60_000
    for (const s of singletons) effectiveMinutes += (s.end - s.start) / 60_000
    const scheduledMinutes = evs.reduce((s, e) => s + e.durationMinutes, 0)
    out.push({
      key,
      date: granularity === 'day' ? key : `${key.split('-')[0]}-${key.split('-').slice(1).join('-')}`,
      events: evs.length,
      scheduledMinutes: Math.round(scheduledMinutes),
      effectiveMinutes: Math.round(effectiveMinutes),
    })
  }
  out.sort((a, b) => (a.key < b.key ? -1 : 1))
  return out
}
