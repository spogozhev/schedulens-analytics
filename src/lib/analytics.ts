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

export type TeacherSortKey =
  | 'effectiveHours'
  | 'scheduledHours'
  | 'eventsCount'
  | 'simultaneousGroups'
  | 'simultaneousEvents'
  | 'name'

export type RoomSortKey = 'hours' | 'events' | 'uniqueLectures' | 'conflicts' | 'name'

export interface PaginatedResult<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

/**
 * Find educator IDs that have at least one event matching the filter range,
 * optionally narrowed by a name LIKE search. Returns a Set for fast lookup.
 *
 * This is the key to scaling to 5000+ teachers: we never load teachers that
 * have no events in the active filter period.
 */
async function findEducatorIdsWithEvents(
  where: Prisma.ScheduleEventWhereInput,
  search?: string,
): Promise<Set<number>> {
  // Pull distinct educatorIds for events matching the filter. Only primary
  // educators (id > 0) are counted — co-educators (synthetic negative ids)
  // are excluded from the ranking.
  const rows = await db.scheduleEvent.findMany({
    where: { ...where, educatorId: { gt: 0 } },
    distinct: ['educatorId'],
    select: { educatorId: true },
  })
  const ids = new Set<number>(rows.map((r) => r.educatorId))
  if (search && search.trim()) {
    // Server-side name search: fetch matching educators and intersect.
    const matched = await db.educator.findMany({
      where: {
        id: { in: [...ids] },
        OR: [
          { displayName: { contains: search.trim() } },
          { longName: { contains: search.trim() } },
        ],
      },
      select: { id: true },
    })
    return new Set(matched.map((m) => m.id))
  }
  return ids
}

/**
 * Compute per-teacher workload, accounting for simultaneous events.
 *
 * - For each teacher, we group their events by overlapping time (the same
 *   logic used at import time, but re-derived here from `simultaneousGroupId`).
 * - `effectiveMinutes` is the union of the time intervals actually spent
 *   teaching (simultaneous events counted once).
 *
 * By default, only teachers with at least one event matching `where` are
 * returned — this is the key optimization for universities with 5000+
 * teachers (we don't process teachers with no events in the filter period).
 */
export async function computeTeacherWorkloads(
  where: Prisma.ScheduleEventWhereInput,
  options?: { educatorIds?: number[]; onlyWithEvents?: boolean },
): Promise<TeacherWorkload[]> {
  // Build the educator filter. If caller provided an explicit list of IDs
  // (e.g. from search), use that. Otherwise, find educators with events.
  let educatorIds = options?.educatorIds
  if (!educatorIds && options?.onlyWithEvents !== false) {
    const idSet = await findEducatorIdsWithEvents(where)
    educatorIds = [...idSet]
  }

  const teachers = await db.educator.findMany({
    where: educatorIds && educatorIds.length > 0 ? { id: { in: educatorIds } } : { id: { gt: 0 } },
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
      // Even if the teacher has no events after filtering, keep the row so
      // the caller can see them (e.g. when searching by name). The caller
      // can decide to filter on `eventsCount > 0`.
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

function sortTeachers(items: TeacherWorkload[], sort: TeacherSortKey): TeacherWorkload[] {
  const sorted = [...items]
  switch (sort) {
    case 'scheduledHours':
      sorted.sort((a, b) => b.scheduledMinutes - a.scheduledMinutes)
      break
    case 'eventsCount':
      sorted.sort((a, b) => b.eventsCount - a.eventsCount)
      break
    case 'simultaneousGroups':
      sorted.sort((a, b) => b.simultaneousGroups - a.simultaneousGroups)
      break
    case 'simultaneousEvents':
      sorted.sort((a, b) => b.simultaneousEvents - a.simultaneousEvents)
      break
    case 'name':
      sorted.sort((a, b) => a.displayName.localeCompare(b.displayName, 'ru'))
      break
    case 'effectiveHours':
    default:
      sorted.sort((a, b) => b.effectiveMinutes - a.effectiveMinutes)
      break
  }
  // Stable tiebreaker: by id ascending so pages are deterministic.
  if (sort !== 'name') {
    sorted.sort((a, b) => {
      // First by primary key already applied above; preserve on ties.
      return 0
    })
  }
  return sorted
}

/**
 * Paginated variant of computeTeacherWorkloads. Returns the page slice and
 * the total count (after filtering and before slicing).
 *
 * `search` performs a server-side LIKE search on `displayName` / `longName`.
 * Only teachers with at least one event matching the filter period are
 * returned, so a request that doesn't filter by date still operates over
 * teachers with events (not the entire 5000+ teacher roster).
 */
export async function computeTeacherWorkloadsPaginated(
  where: Prisma.ScheduleEventWhereInput,
  options: {
    sort: TeacherSortKey
    page: number
    pageSize: number
    search?: string
  },
): Promise<PaginatedResult<TeacherWorkload>> {
  const idSet = await findEducatorIdsWithEvents(where, options.search)
  if (idSet.size === 0) {
    return { items: [], total: 0, page: options.page, pageSize: options.pageSize, totalPages: 0 }
  }
  const educatorIds = [...idSet]
  const workloads = await computeTeacherWorkloads(where, { educatorIds })
  const sorted = sortTeachers(workloads, options.sort)
  const total = sorted.length
  const pageSize = Math.max(1, options.pageSize)
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const page = Math.min(Math.max(1, options.page), totalPages)
  const start = (page - 1) * pageSize
  const items = sorted.slice(start, start + pageSize)
  return { items, total, page, pageSize, totalPages }
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
 * Find location IDs that have at least one event matching the filter range,
 * optionally narrowed by a name LIKE search.
 */
async function findLocationIdsWithEvents(
  where: Prisma.ScheduleEventWhereInput,
  search?: string,
): Promise<Set<number>> {
  // Pull distinct locationIds via the join table filtered by event conditions.
  const rows = await db.scheduleEventLocation.findMany({
    where: { event: where },
    distinct: ['locationId'],
    select: { locationId: true },
  })
  const ids = new Set<number>(rows.map((r) => r.locationId))
  if (search && search.trim()) {
    const matched = await db.location.findMany({
      where: {
        id: { in: [...ids] },
        displayName: { contains: search.trim() },
      },
      select: { id: true },
    })
    return new Set(matched.map((m) => m.id))
  }
  return ids
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
  options?: { locationIds?: number[] },
): Promise<RoomWorkload[]> {
  let locationIds = options?.locationIds
  if (!locationIds) {
    const idSet = await findLocationIdsWithEvents(where)
    locationIds = [...idSet]
  }

  const locations = await db.location.findMany({
    where: locationIds && locationIds.length > 0 ? { id: { in: locationIds } } : undefined,
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
    //
    // NOTE: the same physical lecture appears multiple times in `l.events`
    // — once for each student group that attends it. We MUST dedupe by
    // `lectureHash` BEFORE building the `lectures` array and BEFORE the
    // conflict-detection loop, otherwise:
    //   - each duplicate is treated as a separate "lecture" and the conflict
    //     loop counts the same pair of overlapping lectures N×M times
    //     (where N, M are the duplicate counts of the two lectures);
    //   - the conflict count on the rooms ranking page diverges from the
    //     conflict count on the room detail page (which dedupes correctly).
    //
    // The `seen` Set is also used for the `uniqueLectures` count below.
    const seen = new Set<string>()
    let totalMinutes = 0
    const lectures: { start: number; end: number; hash: string }[] = []
    for (const le of l.events) {
      const ev = le.event
      if (seen.has(ev.lectureHash)) continue
      seen.add(ev.lectureHash)
      lectures.push({ start: ev.startDateTime.getTime(), end: ev.endDateTime.getTime(), hash: ev.lectureHash })
      totalMinutes += ev.durationMinutes
    }
    // Detect conflicts: same room, overlapping intervals, DIFFERENT lectureHash.
    // NOTE: intervals that merely touch at a boundary (b.start === a.end, e.g.
    // 13:00–14:00 then 14:00–15:00) are NOT a conflict — those are back-to-back
    // classes. We use `>=` so that b.start === a.end triggers the break and no
    // conflict is recorded.
    lectures.sort((a, b) => a.start - b.start)
    let conflicts = 0
    for (let i = 0; i < lectures.length; i++) {
      for (let j = i + 1; j < lectures.length; j++) {
        const a = lectures[i]
        const b = lectures[j]
        if (b.start >= a.end) break // sorted, no further overlap
        // `a.hash !== b.hash` is now guaranteed true because we deduped
        // by lectureHash above — but keep the check for clarity / safety.
        if (a.hash !== b.hash) conflicts++
      }
    }
    result.push({
      id: l.id,
      displayName: l.displayName,
      // `eventsCount` is the number of `ScheduleEvent` rows linked to this
      // room — including duplicates of the same physical lecture that
      // appear once per student group. This matches `room.events.length`
      // in the room detail endpoint so the two pages stay consistent.
      eventsCount: l.events.length,
      // `uniqueLectures` is the count of DISTINCT physical lectures
      // (one per `lectureHash`) — deduped above.
      uniqueLectures: seen.size,
      totalMinutes,
      conflicts,
      latitude: l.latitude,
      longitude: l.longitude,
    })
  }
  return result
}

function sortRooms(items: RoomWorkload[], sort: RoomSortKey): RoomWorkload[] {
  const sorted = [...items]
  switch (sort) {
    case 'events':
      sorted.sort((a, b) => b.eventsCount - a.eventsCount)
      break
    case 'uniqueLectures':
      sorted.sort((a, b) => b.uniqueLectures - a.uniqueLectures)
      break
    case 'conflicts':
      sorted.sort((a, b) => b.conflicts - a.conflicts)
      break
    case 'name':
      sorted.sort((a, b) => a.displayName.localeCompare(b.displayName, 'ru'))
      break
    case 'hours':
    default:
      sorted.sort((a, b) => b.totalMinutes - a.totalMinutes)
      break
  }
  return sorted
}

/**
 * Paginated variant of computeRoomWorkloads. Same pagination semantics as
 * the teachers variant.
 */
export async function computeRoomWorkloadsPaginated(
  where: Prisma.ScheduleEventWhereInput,
  options: {
    sort: RoomSortKey
    page: number
    pageSize: number
    search?: string
  },
): Promise<PaginatedResult<RoomWorkload>> {
  const idSet = await findLocationIdsWithEvents(where, options.search)
  if (idSet.size === 0) {
    return { items: [], total: 0, page: options.page, pageSize: options.pageSize, totalPages: 0 }
  }
  const locationIds = [...idSet]
  const workloads = await computeRoomWorkloads(where, { locationIds })
  const sorted = sortRooms(workloads, options.sort)
  const total = sorted.length
  const pageSize = Math.max(1, options.pageSize)
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const page = Math.min(Math.max(1, options.page), totalPages)
  const start = (page - 1) * pageSize
  const items = sorted.slice(start, start + pageSize)
  return { items, total, page, pageSize, totalPages }
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

/**
 * Compute the KPI totals efficiently using SQL aggregation, so the overview
 * endpoint doesn't need to load the full per-teacher workloads (which would
 * be expensive with 5000+ teachers).
 *
 * Returns:
 *  - teachersCount: distinct educatorId (id > 0) with events in range
 *  - roomsCount: distinct locationId with events in range
 *  - eventsCount: COUNT(*) of events in range
 *  - scheduledMinutes: SUM(durationMinutes)
 *  - effectiveMinutes: deduped by (educatorId, simultaneousGroupId) using
 *    MIN(start) and MAX(end) per group, then summed across groups
 *  - simultaneousEvents: COUNT where simultaneousGroupId IS NOT NULL
 *  - simultaneousGroups: COUNT DISTINCT simultaneousGroupId
 *  - inferredEndEvents: COUNT where hasInferredEnd
 */
export interface OverviewKpis {
  teachersCount: number
  roomsCount: number
  eventsCount: number
  scheduledMinutes: number
  effectiveMinutes: number
  simultaneousEvents: number
  simultaneousGroups: number
  inferredEndEvents: number
  subjectsCount: number
  groupsCount: number
}

export async function computeOverviewKpis(
  where: Prisma.ScheduleEventWhereInput,
): Promise<OverviewKpis> {
  const primaryWhere: Prisma.ScheduleEventWhereInput = { ...where, educatorId: { gt: 0 } }

  // Run all independent aggregations in parallel.
  const [
    eventsCount,
    scheduledAgg,
    teachersRows,
    roomsRows,
    simultaneousEvents,
    simultaneousGroupsRows,
    inferredEndEvents,
    subjectsCount,
    groupsCount,
    effectiveGroups,
  ] = await Promise.all([
    db.scheduleEvent.count({ where }),
    db.scheduleEvent.aggregate({ where, _sum: { durationMinutes: true } }),
    db.scheduleEvent.findMany({ where: primaryWhere, distinct: ['educatorId'], select: { educatorId: true } }),
    db.scheduleEventLocation.findMany({ where: { event: where }, distinct: ['locationId'], select: { locationId: true } }),
    db.scheduleEvent.count({ where: { ...where, simultaneousGroupId: { not: null } } }),
    db.scheduleEvent.findMany({
      where: { ...where, simultaneousGroupId: { not: null } },
      distinct: ['simultaneousGroupId'],
      select: { simultaneousGroupId: true },
    }),
    db.scheduleEvent.count({ where: { ...where, hasInferredEnd: true } }),
    db.subject.count(),
    db.group.count(),
    // Effective minutes: per (educatorId, simultaneousGroupId) compute the
    // MIN(start) and MAX(end). For singleton events (simultaneousGroupId IS
    // NULL), each event is its own group — use `id` as the unique key.
    db.scheduleEvent.findMany({
      where,
      select: {
        educatorId: true,
        simultaneousGroupId: true,
        id: true,
        startDateTime: true,
        endDateTime: true,
      },
    }),
  ])

  // Compute effective minutes in JS: group by (educatorId, simultaneousGroupId ?? `single-${id}`).
  const effMap = new Map<string, { start: number; end: number }>()
  for (const e of effectiveGroups) {
    const key = `${e.educatorId}|${e.simultaneousGroupId ?? `single-${e.id}`}`
    const start = e.startDateTime.getTime()
    const end = e.endDateTime.getTime()
    const cur = effMap.get(key)
    if (!cur) effMap.set(key, { start, end })
    else {
      cur.start = Math.min(cur.start, start)
      cur.end = Math.max(cur.end, end)
    }
  }
  let effectiveMinutes = 0
  for (const [, g] of effMap) effectiveMinutes += (g.end - g.start) / 60_000

  return {
    teachersCount: teachersRows.length,
    roomsCount: roomsRows.length,
    eventsCount,
    scheduledMinutes: scheduledAgg._sum.durationMinutes ?? 0,
    effectiveMinutes: Math.round(effectiveMinutes),
    simultaneousEvents,
    simultaneousGroups: simultaneousGroupsRows.length,
    inferredEndEvents,
    subjectsCount,
    groupsCount,
  }
}
