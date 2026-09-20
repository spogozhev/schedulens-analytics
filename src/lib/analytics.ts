import { db } from '@/lib/db'
import { withTiming } from '@/lib/timing'
import {
  adaptPlaceholders,
  boolFalse,
  dayBucketExpr,
  epochMillis,
  hourExpr,
  isoWeekBucketExpr,
  likeEscapeClause,
  monthExpr,
} from '@/lib/sql-dialect'
import type { Prisma } from '@prisma/client'

/** Dialect-aware raw query: converts `?` placeholders for PostgreSQL. */
const rawQuery = (sql: string, ...params: (string | number)[]) =>
  db.$queryRawUnsafe(adaptPlaceholders(sql), ...params)

// Maps kindCode to a human-readable Russian label.
export const KIND_LABELS: Record<number, string> = {
  0: 'Индивидуальные мероприятия',
  1: 'Регулярные занятия',
  2: 'Сессия / консультации',
  3: 'ГИА',
}

export interface DateRange {
  from: Date | null
  to: Date | null
}

export interface CommonFilters {
  /** Comma-separated DateRange ids (e.g. "1,3"). Empty/absent = all periods. */
  dateRangeIds?: string | null
  /** Comma-separated LessonForm ids (e.g. "1,4"). Empty/absent = all forms. */
  lessonFormIds?: string | null
  kindCode?: string | null
  includeCanceled?: string | null
}

/** Parse the common dashboard filters from a request URL's query string. */
export function parseCommonFilters(url: URL): CommonFilters {
  return {
    dateRangeIds: url.searchParams.get('dateRangeIds'),
    lessonFormIds: url.searchParams.get('lessonFormIds'),
    kindCode: url.searchParams.get('kindCode'),
    includeCanceled: url.searchParams.get('includeCanceled') ?? 'false',
  }
}

/** Parse a comma-separated id list into positive integers. */
export function parseIdList(s: string | null | undefined): number[] {
  if (!s) return []
  return s
    .split(',')
    .map((x) => Number(x.trim()))
    .filter((n) => Number.isInteger(n) && n > 0)
}

/** Convert minutes to hours rounded to 1 decimal — API response formatting. */
export function roundHours(minutes: number): number {
  return Math.round((minutes / 60) * 10) / 10
}

/** Build a Prisma where-clause fragment for ScheduleEvent based on common filters. */
export function buildEventWhere(filters: CommonFilters): Prisma.ScheduleEventWhereInput {
  const where: Prisma.ScheduleEventWhereInput = {}
  const dateRangeIds = parseIdList(filters.dateRangeIds)
  if (dateRangeIds.length > 0) {
    where.dateRangeId = { in: dateRangeIds }
  }
  const lessonFormIds = parseIdList(filters.lessonFormIds)
  if (lessonFormIds.length > 0) {
    where.lessonFormId = { in: lessonFormIds }
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

// =====================================================
// Raw-SQL helpers
//
// The heavy dashboard computations below are implemented as single
// aggregation queries (GROUP BY) instead of loading every matching event
// into JS: with 400k+ events the Prisma row materialization alone costs
// tens of seconds, while SQLite answers the aggregates in one pass.
//
// All time arithmetic relies on `startDateTime`/`endDateTime` being stored
// as a Unix epoch in MILLISECONDS (Prisma/SQLite DateTime mapping).
// =====================================================

interface SqlWhere {
  conditions: string[]
  params: (string | number)[]
}

/**
 * Translate common filters into raw SQL conditions on ScheduleEvent.
 * Mirrors `buildEventWhere` semantics exactly. `alias` qualifies the column
 * names when the event table is joined under an alias.
 */
function sqlEventWhere(where: Prisma.ScheduleEventWhereInput, alias?: string): SqlWhere {
  // Quoted identifiers work on both SQLite and PostgreSQL; quoting is
  // required on PG, where unquoted names fold to lowercase.
  const col = (name: string) => (alias ? `${alias}."${name}"` : `"${name}"`)
  const conditions: string[] = []
  const params: (string | number)[] = []
  const dateRangeFilter = where.dateRangeId as { in?: number[] } | undefined
  if (
    dateRangeFilter &&
    typeof dateRangeFilter === 'object' &&
    Array.isArray(dateRangeFilter.in) &&
    dateRangeFilter.in.length > 0
  ) {
    conditions.push(`${col('dateRangeId')} IN (${dateRangeFilter.in.map(() => '?').join(',')})`)
    params.push(...dateRangeFilter.in)
  }
  const lessonFormFilter = where.lessonFormId as { in?: number[] } | undefined
  if (
    lessonFormFilter &&
    typeof lessonFormFilter === 'object' &&
    Array.isArray(lessonFormFilter.in) &&
    lessonFormFilter.in.length > 0
  ) {
    conditions.push(`${col('lessonFormId')} IN (${lessonFormFilter.in.map(() => '?').join(',')})`)
    params.push(...lessonFormFilter.in)
  }
  if (where.kindCode !== undefined && typeof where.kindCode === 'number') {
    conditions.push(`${col('kindCode')} = ?`)
    params.push(where.kindCode)
  }
  if (where.isCanceled === false) {
    conditions.push(`${col('isCanceled')} = ${boolFalse}`)
  }
  return { conditions, params }
}

/** Escape a user-supplied search string for use inside a LIKE pattern. */
function likeEscape(s: string): string {
  return s.replace(/[\\%_]/g, (ch) => `\\${ch}`)
}

/** Collect params each time a shared condition snippet is embedded in SQL. */
function condWithParams(w: SqlWhere, params: (string | number)[]): string {
  params.push(...w.params)
  const cond = w.conditions.join(' AND ')
  // '1=1' keeps the SQL valid when no filters are active (includeCanceled=true).
  return cond.length > 0 ? cond : '1=1'
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
 * Only primary educators (id > 0) are counted — co-educators (synthetic
 * negative ids) are excluded from the ranking.
 *
 * `SELECT DISTINCT educatorId` streams along the (educatorId, startDateTime)
 * index — an order of magnitude faster than Prisma's distinct, which loads
 * every matching event id.
 */
async function findEducatorIdsWithEvents(
  where: Prisma.ScheduleEventWhereInput,
  search?: string,
  topLevelUnitId?: number,
): Promise<Set<number>> {
  return withTiming('analytics:findEducatorIdsWithEvents', async (): Promise<Set<number>> => {
    const w = sqlEventWhere(where, 'ev')
    w.conditions.push('ev."educatorId" > 0')
    const params: (string | number)[] = []
    const needle = search && search.trim() ? `%${likeEscape(search.trim())}%` : null
    // Filter by the educator's first-level unit (denormalized on Educator).
    const unitCondition = (): string => {
      if (!topLevelUnitId) return ''
      params.push(topLevelUnitId)
      return ` AND EXISTS (SELECT 1 FROM "Educator" edu
                             WHERE edu."id" = ev."educatorId"
                               AND edu."topLevelUnitId" = ?)`
    }
    let sql: string
    if (needle) {
      params.push(...w.params)
      const cond = w.conditions.join(' AND ') + unitCondition()
      params.push(needle, needle)
      sql = `SELECT DISTINCT ev."educatorId" AS id
             FROM "ScheduleEvent" ev
             JOIN "Educator" ed ON ed."id" = ev."educatorId"
             WHERE ${cond}
               AND (ed."displayName" LIKE ? ${likeEscapeClause} OR ed."longName" LIKE ? ${likeEscapeClause})`
    } else {
      params.push(...w.params)
      const cond = w.conditions.join(' AND ') + unitCondition()
      sql = `SELECT DISTINCT ev."educatorId" AS id
             FROM "ScheduleEvent" ev
             WHERE ${cond}`
    }
    const rows = (await rawQuery(sql, ...params)) as Array<{ id: number | bigint }>
    return new Set(rows.map((r) => Number(r.id)))
  })
}

/**
 * Compute per-teacher workload, accounting for simultaneous events.
 *
 * - `effectiveMinutes` is the union of the time intervals actually spent
 *   teaching (simultaneous events counted once): per
 *   (educatorId, simultaneousGroupId) the interval is MIN(start)…MAX(end),
 *   and the intervals are summed across groups.
 * - By default, only teachers with at least one event matching `where` are
 *   returned — this is the key optimization for universities with 5000+
 *   teachers (we don't process teachers with no events in the filter period).
 *
 * Implemented as a single GROUP BY aggregation: with 400k+ events, loading
 * every event into JS costs tens of seconds, SQLite answers this in ~2s.
 */
export async function computeTeacherWorkloads(
  where: Prisma.ScheduleEventWhereInput,
  options?: { educatorIds?: number[] },
): Promise<TeacherWorkload[]> {
  return withTiming('analytics:computeTeacherWorkloads', async () => {
    const w = sqlEventWhere(where, 'ev')
    const educatorFilter = (params: (string | number)[]): string => {
      const ids = options?.educatorIds
      if (!ids || ids.length === 0) return ''
      params.push(...ids)
      return ` AND ev."educatorId" IN (${ids.map(() => '?').join(',')})`
    }

    // Prisma raw queries return BigInt for COUNT/SUM aggregates — every
    // numeric column is mapped through Number() below.
    const params: (string | number)[] = []
    const rows = (await rawQuery(
      `WITH eff AS (
         SELECT educatorId AS id, SUM(mx - mn) AS effMs
         FROM (
           SELECT ev."educatorId" AS educatorId,
                  MIN(${epochMillis('ev."startDateTime"')}) AS mn,
                  MAX(${epochMillis('ev."endDateTime"')}) AS mx
           FROM "ScheduleEvent" ev
           WHERE ${condWithParams(w, params)}${educatorFilter(params)}
           GROUP BY ev."educatorId", COALESCE(ev."simultaneousGroupId", 'single-' || ev."id")
         )
         GROUP BY educatorId
       ),
       base AS (
         SELECT ev."educatorId" AS id,
                COUNT(*) AS "eventsCount",
                SUM(ev."durationMinutes") AS "scheduledMinutes",
                SUM(CASE WHEN ev."simultaneousGroupId" IS NOT NULL THEN 1 ELSE 0 END) AS "simultaneousEvents",
                COUNT(DISTINCT ev."simultaneousGroupId") AS "simultaneousGroups",
                SUM(CASE WHEN ev."hasInferredEnd" THEN 1 ELSE 0 END) AS "inferredEndEvents",
                SUM(CASE WHEN ev."isCanceled" THEN 1 ELSE 0 END) AS "canceledEvents"
         FROM "ScheduleEvent" ev
         WHERE ${condWithParams(w, params)}${educatorFilter(params)}
         GROUP BY ev."educatorId"
       )
       SELECT b.id AS id,
              ed."displayName" AS "displayName",
              ed."longName" AS "longName",
              CAST(b."eventsCount" AS INTEGER) AS "eventsCount",
              CAST(b."scheduledMinutes" AS INTEGER) AS "scheduledMinutes",
              CAST(ROUND(COALESCE(eff.effMs, 0) / 60000.0) AS INTEGER) AS "effectiveMinutes",
              CAST(b."simultaneousEvents" AS INTEGER) AS "simultaneousEvents",
              CAST(b."simultaneousGroups" AS INTEGER) AS "simultaneousGroups",
              CAST(b."inferredEndEvents" AS INTEGER) AS "inferredEndEvents",
              CAST(b."canceledEvents" AS INTEGER) AS "canceledEvents"
       FROM base b
       JOIN "Educator" ed ON ed."id" = b.id
       LEFT JOIN eff ON eff.id = b.id
       ORDER BY b.id`,
      ...params,
    )) as Array<Record<string, unknown>>

    return rows.map((r) => ({
      id: Number(r.id),
      displayName: String(r.displayName),
      longName: String(r.longName),
      eventsCount: Number(r.eventsCount),
      scheduledMinutes: Number(r.scheduledMinutes),
      effectiveMinutes: Number(r.effectiveMinutes),
      simultaneousEvents: Number(r.simultaneousEvents),
      simultaneousGroups: Number(r.simultaneousGroups),
      inferredEndEvents: Number(r.inferredEndEvents),
      canceledEvents: Number(r.canceledEvents),
    }))
  })
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
    /** Restrict the list to educators of this first-level unit. */
    topLevelUnitId?: number
  },
): Promise<PaginatedResult<TeacherWorkload>> {
  const idSet = await findEducatorIdsWithEvents(where, options.search, options.topLevelUnitId)
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
 * Compute per-room workload. Multiple teacher rows for the same physical
 * lecture (same `lectureHash`) are counted once for utilization.
 *
 * `conflicts` is the count of times a room was double-booked (overlapping
 * intervals belonging to *different* physical lectures).
 *
 * Reads locations from two arms (see schema — the primary location is
 * denormalized onto ScheduleEvent.locationId; ScheduleEventLocation holds
 * only additional ones): the fast arm scans ScheduleEvent without any join,
 * the extra arm touches the much smaller links table (~52k rows vs 460k).
 * The conflict sweep runs in JS: lectures are sorted by start time and the
 * inner loop breaks at the first non-overlapping lecture.
 */
export async function computeRoomWorkloads(
  where: Prisma.ScheduleEventWhereInput,
  options?: { locationIds?: number[] },
): Promise<RoomWorkload[]> {
  return withTiming('analytics:computeRoomWorkloads', async () => {
    const w = sqlEventWhere(where, 'se')
    const ids = options?.locationIds
    // An IN-list over locations changes SQLite's plan for the worse once it
    // grows past ~100 items (measured: IN(200) 3.5s, IN(500) 32s vs 5.9s
    // unfiltered on a 400k-event dataset). Small lists are cheap, so filter
    // in SQL; large lists are computed without the filter and narrowed in JS.
    const useSqlIdFilter = ids !== undefined && ids.length > 0 && ids.length <= 100
    const idPlaceholders = useSqlIdFilter ? ids.map(() => '?').join(',') : ''

    const params: (string | number)[] = []
    // Conditions are embedded once per arm — collect params per embed. The
    // IN-list filters a different table per arm, hence the two variants.
    const armWhere = (col: string): string => {
      let sql = condWithParams(w, params)
      if (useSqlIdFilter) {
        params.push(...ids)
        sql += ` AND ${col}."locationId" IN (${idPlaceholders})`
      }
      return sql
    }
    const condFast = armWhere('se')
    const condExtra = armWhere('sel')

    // Dedupe by lectureHash before anything else: the same physical lecture
    // appears once per student group, and duplicates would inflate both the
    // totals and the conflict count. (rid, hsh) cannot span arms — extra
    // links never repeat an event's primary location — the outer GROUP BY
    // re-merge is just a safety net.
    const rows = (await rawQuery(
      `SELECT rid, hsh, SUM("rawCnt") AS "rawCnt", MIN(st) AS st, MAX(en) AS en, MAX(dur) AS dur
       FROM (
         SELECT se."locationId" AS rid,
                se."lectureHash" AS hsh,
                COUNT(*) AS "rawCnt",
                MIN(${epochMillis('se."startDateTime"')}) AS st,
                MAX(${epochMillis('se."endDateTime"')}) AS en,
                MAX(se."durationMinutes") AS dur
         FROM "ScheduleEvent" se
         WHERE se."locationId" IS NOT NULL AND ${condFast}
         GROUP BY se."locationId", se."lectureHash"
         UNION ALL
         SELECT sel."locationId" AS rid,
                se."lectureHash" AS hsh,
                COUNT(*) AS "rawCnt",
                MIN(${epochMillis('se."startDateTime"')}) AS st,
                MAX(${epochMillis('se."endDateTime"')}) AS en,
                MAX(se."durationMinutes") AS dur
         FROM "ScheduleEventLocation" sel
         JOIN "ScheduleEvent" se ON se."id" = sel."eventId"
         WHERE (se."locationId" IS NULL OR sel."locationId" <> se."locationId") AND ${condExtra}
         GROUP BY sel."locationId", se."lectureHash"
       )
       GROUP BY rid, hsh
       ORDER BY rid, st, hsh`,
      ...params,
    )) as Array<{ rid: number | bigint; hsh: string; st: number | bigint; en: number | bigint; rawCnt: number | bigint; dur: number | bigint }>

    interface Lect {
      rid: number
      hsh: string
      rawCnt: number
      st: number
      en: number
      dur: number
    }
    const byRoom = new Map<number, { room: RoomWorkload; lectures: Lect[] }>()
    for (const r of rows) {
      const rid = Number(r.rid)
      let entry = byRoom.get(rid)
      if (!entry) {
        entry = {
          room: {
            id: rid,
            displayName: '',
            eventsCount: 0,
            uniqueLectures: 0,
            totalMinutes: 0,
            conflicts: 0,
            latitude: null,
            longitude: null,
          },
          lectures: [],
        }
        byRoom.set(rid, entry)
      }
      const rawCnt = Number(r.rawCnt)
      entry.room.eventsCount += rawCnt
      entry.room.uniqueLectures += 1
      entry.room.totalMinutes += Number(r.dur)
      entry.lectures.push({
        rid,
        hsh: String(r.hsh),
        rawCnt,
        st: Number(r.st),
        en: Number(r.en),
        dur: Number(r.dur),
      })
    }

    // Room display names / coordinates in one small query.
    const roomIds = [...byRoom.keys()]
    if (roomIds.length > 0) {
      const meta = (await rawQuery(
        `SELECT "id", "displayName", "latitude", "longitude" FROM "Location"
         WHERE "id" IN (${roomIds.map(() => '?').join(',')})`,
        ...roomIds,
      )) as Array<{ id: number | bigint; displayName: string; latitude: number | null; longitude: number | null }>
      for (const m of meta) {
        const entry = byRoom.get(Number(m.id))
        if (entry) {
          entry.room.displayName = String(m.displayName)
          entry.room.latitude = m.latitude === null ? null : Number(m.latitude)
          entry.room.longitude = m.longitude === null ? null : Number(m.longitude)
        }
      }
    }

    // Conflicts: pairs of different lectures in the same room whose intervals
    // overlap. Rows are ordered by (rid, st, hsh); for each lecture i the
    // inner pointer j starts at i+1 and stops at the first lecture starting
    // at/after en_i — O(L + pairs) instead of O(L²).
    const result: RoomWorkload[] = []
    for (const { room, lectures } of byRoom.values()) {
      let conflicts = 0
      for (let i = 0; i < lectures.length; i++) {
        const a = lectures[i]
        for (let j = i + 1; j < lectures.length; j++) {
          const b = lectures[j]
          if (b.st >= a.en) break
          // (rid, hsh) is unique in the deduped set, so b.hsh !== a.hsh
          // always holds here — no check needed.
          conflicts++
        }
      }
      room.conflicts = conflicts
      result.push(room)
    }

    if (ids !== undefined && !useSqlIdFilter) {
      // Narrow the full computation down to the requested rooms.
      const wanted = new Set(ids)
      return result.filter((r) => wanted.has(r.id))
    }
    return result
  })
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
    /** Restrict the ranking to rooms at these addresses (Address.id list). */
    addressIds?: number[]
  },
): Promise<PaginatedResult<RoomWorkload>> {
  const idSet = await findLocationIdsWithEvents(where, options.search, options.addressIds)
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

/**
 * Find location IDs that have at least one event matching the filter range,
 * optionally narrowed by a name LIKE search and/or by the parsed address
 * (Address.id list).
 *
 * Two arms (see schema): events' denormalized primary location, plus the
 * additional-location links table (~52k rows).
 */
async function findLocationIdsWithEvents(
  where: Prisma.ScheduleEventWhereInput,
  search?: string,
  addressIds?: number[],
): Promise<Set<number>> {
  return withTiming('analytics:findLocationIdsWithEvents', async (): Promise<Set<number>> => {
    const w = sqlEventWhere(where, 'se')
    const params: (string | number)[] = []
    const needle = search && search.trim() ? `%${likeEscape(search.trim())}%` : null
    const addrIds = addressIds ?? []
    const useAddressJoin = addrIds.length > 0
    const usesLocJoin = Boolean(needle) || useAddressJoin
    // Embeds the conditions (and the search/address params) once per arm.
    const armWhere = (col: string): string => {
      let sql = condWithParams(w, params)
      if (needle) {
        params.push(needle)
        sql += ` AND l."displayName" LIKE ? ${likeEscapeClause}`
      }
      if (useAddressJoin) {
        params.push(...addrIds)
        sql += ` AND l."addressId" IN (${addrIds.map(() => '?').join(',')})`
      }
      return sql
    }
    const locJoinFast = usesLocJoin ? `JOIN "Location" l ON l."id" = se."locationId"` : ''
    const locJoinExtra = usesLocJoin ? `JOIN "Location" l ON l."id" = sel."locationId"` : ''
    const extraGuard = `(se."locationId" IS NULL OR sel."locationId" <> se."locationId")`

    const sql = `SELECT DISTINCT rid AS id FROM (
       SELECT se."locationId" AS rid
         FROM "ScheduleEvent" se ${locJoinFast}
        WHERE se."locationId" IS NOT NULL AND ${armWhere('se')}
       UNION ALL
       SELECT sel."locationId" AS rid
         FROM "ScheduleEventLocation" sel
         JOIN "ScheduleEvent" se ON se."id" = sel."eventId" ${locJoinExtra}
        WHERE ${extraGuard} AND ${armWhere('sel')}
     )`
    const rows = (await rawQuery(sql, ...params)) as Array<{ id: number | bigint }>
    return new Set(rows.map((r) => Number(r.id)))
  })
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

/** SQLite/PostgreSQL-agnostic bucket key expression (see sql-dialect.ts). */
function timelineBucketExpr(granularity: 'day' | 'week'): string {
  return granularity === 'day'
    ? dayBucketExpr('"startDateTime"')
    : isoWeekBucketExpr('"startDateTime"')
}

/**
 * Aggregate events into buckets (by day or week) for the timeline chart.
 * Single GROUP BY: events and scheduled minutes are event-level; effective
 * minutes are per (bucket, educator, simultaneous group) MIN(start)/MAX(end)
 * union, summed per bucket. Simultaneous groups share the same time slot, so
 * they never span buckets.
 */
export async function computeTimeline(
  where: Prisma.ScheduleEventWhereInput,
  granularity: 'day' | 'week' = 'week',
): Promise<TimelineBucket[]> {
  return withTiming('analytics:timeline:compute', async () => {
    const w = sqlEventWhere(where)
    const params: (string | number)[] = []
    const cond = condWithParams(w, params)
    const rows = (await rawQuery(
      `SELECT bk AS key,
              CAST(SUM(cnt) AS INTEGER) AS events,
              CAST(SUM(sched) AS INTEGER) AS "scheduledMinutes",
              CAST(ROUND(SUM(mx - mn) / 60000.0) AS INTEGER) AS "effectiveMinutes"
       FROM (
         SELECT ${timelineBucketExpr(granularity)} AS bk,
                COUNT(*) AS cnt,
                SUM("durationMinutes") AS sched,
                MIN(${epochMillis('"startDateTime"')}) AS mn,
                MAX(${epochMillis('"endDateTime"')}) AS mx
         FROM "ScheduleEvent"
         WHERE ${cond}
         GROUP BY bk, "educatorId", COALESCE("simultaneousGroupId", 'single-' || "id")
       )
       GROUP BY bk
       ORDER BY bk`,
      ...params,
    )) as Array<Record<string, unknown>>

    return rows.map((r) => ({
      key: String(r.key),
      date: String(r.key),
      events: Number(r.events),
      scheduledMinutes: Number(r.scheduledMinutes),
      effectiveMinutes: Number(r.effectiveMinutes),
    }))
  })
}

/**
 * Compute the KPI totals as a single raw aggregation query. Previously these
 * were Prisma aggregate/count calls — each wrapped in a `LIMIT/OFFSET`
 * subquery that scanned all 400k+ events (measured ~13s per COUNT) — plus a
 * full event load for the effective-minutes dedup. The same numbers in one
 * GROUP BY query take ~1-2s.
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
  return withTiming('analytics:overviewKpis:sql-agg', async () => {
    const w = sqlEventWhere(where)
    const params: (string | number)[] = []
    const cond = () => condWithParams(w, params)
    const rows = (await rawQuery(
      `SELECT
         (SELECT COUNT(*) FROM "ScheduleEvent" ev WHERE ${cond()}) AS "eventsCount",
         (SELECT COALESCE(SUM(ev."durationMinutes"), 0) FROM "ScheduleEvent" ev WHERE ${cond()}) AS "scheduledMinutes",
         (SELECT COUNT(DISTINCT ev."educatorId") FROM "ScheduleEvent" ev WHERE ${cond()} AND ev."educatorId" > 0) AS "teachersCount",
         (SELECT COUNT(*) FROM (
            SELECT DISTINCT "locationId" AS rid
              FROM "ScheduleEvent"
             WHERE ${cond()} AND "locationId" IS NOT NULL
            UNION
            SELECT DISTINCT sel."locationId" AS rid
              FROM "ScheduleEventLocation" sel
              JOIN "ScheduleEvent" se ON se."id" = sel."eventId"
             WHERE (se."locationId" IS NULL OR sel."locationId" <> se."locationId") AND ${cond()}
          )) AS "roomsCount",
         (SELECT COUNT(*) FROM "ScheduleEvent" ev WHERE ${cond()} AND ev."simultaneousGroupId" IS NOT NULL) AS "simultaneousEvents",
         (SELECT COUNT(DISTINCT ev."simultaneousGroupId") FROM "ScheduleEvent" ev WHERE ${cond()} AND ev."simultaneousGroupId" IS NOT NULL) AS "simultaneousGroups",
         (SELECT COUNT(*) FROM "ScheduleEvent" ev WHERE ${cond()} AND ev."hasInferredEnd") AS "inferredEndEvents",
         (SELECT COUNT(*) FROM "Subject") AS "subjectsCount",
         (SELECT COUNT(*) FROM "Group") AS "groupsCount",
         (SELECT COALESCE(SUM(mx - mn), 0) FROM (
            SELECT MIN(${epochMillis('ev."startDateTime"')}) AS mn, MAX(${epochMillis('ev."endDateTime"')}) AS mx
            FROM "ScheduleEvent" ev
            WHERE ${cond()}
            GROUP BY ev."educatorId", COALESCE(ev."simultaneousGroupId", 'single-' || ev."id")
          )) AS "effectiveMs"`,
      ...params,
    )) as Array<Record<string, unknown>>
    const r = rows[0]
    return {
      teachersCount: Number(r.teachersCount),
      roomsCount: Number(r.roomsCount),
      eventsCount: Number(r.eventsCount),
      scheduledMinutes: Number(r.scheduledMinutes),
      effectiveMinutes: Math.round(Number(r.effectiveMs) / 60_000),
      simultaneousEvents: Number(r.simultaneousEvents),
      simultaneousGroups: Number(r.simultaneousGroups),
      inferredEndEvents: Number(r.inferredEndEvents),
      subjectsCount: Number(r.subjectsCount),
      groupsCount: Number(r.groupsCount),
    }
  })
}

/** Month names in Russian (1-indexed for clarity). */
const MONTH_NAMES_RU = [
  '', 'Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн',
  'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек',
]

/**
 * Aggregate events by (month, kindCode) using raw SQL — much faster than
 * pulling all events into JS and grouping there. Returns a flat array of
 * `{ month, monthLabel, kindCode, count }` rows sorted by month.
 */
export async function computeByMonthByKind(
  where: Prisma.ScheduleEventWhereInput,
): Promise<{ month: number; monthLabel: string; kindCode: number; count: number }[]> {
  const w = sqlEventWhere(where)
  const params: (string | number)[] = []
  const cond = condWithParams(w, params)
  const whereClause = cond.length > 0 ? `WHERE ${cond}` : ''

  // Note: COUNT(*) returns a BigInt in better-sqlite3 / Prisma raw queries,
  // so we wrap it in `CAST(... AS INTEGER)` to get a JS number.
  const rows = (await withTiming(
    'analytics:byMonthByKind:sql',
    () =>
      rawQuery(
        `SELECT ${monthExpr('"startDateTime"')} AS month,
            "kindCode",
            CAST(COUNT(*) AS INTEGER) AS count
       FROM "ScheduleEvent"
       ${whereClause}
       GROUP BY month, "kindCode"
       ORDER BY month ASC, "kindCode" ASC`,
        ...params,
      ) as Promise<Array<{ month: number; kindCode: number; count: number }>>,
  )) as Array<{ month: number; kindCode: number; count: number }>

  return rows.map((r) => ({
    // SQLite returns BigInt for COUNT and CAST-INTEGER columns even when
    // we CAST them. Coerce to Number for JS-friendly JSON serialization.
    month: Number(r.month),
    monthLabel: MONTH_NAMES_RU[Number(r.month)] ?? `М${r.month}`,
    kindCode: Number(r.kindCode),
    count: Number(r.count),
  }))
}

export interface HeatmapCell {
  day: number
  dayName: string
  hour: number
  events: number
  simultaneous: number
}

/**
 * 7×24 grid (day of week × hour) of event counts for the heatmap card.
 * Single GROUP BY query; the grid is filled from the ~100 non-empty
 * (day, hour) rows instead of materializing every event.
 */
export async function computeHeatmap(
  where: Prisma.ScheduleEventWhereInput,
): Promise<HeatmapCell[][]> {
  return withTiming('analytics:heatmap:compute', async () => {
    const w = sqlEventWhere(where, 'ev')
    const params: (string | number)[] = []
    const cond = condWithParams(w, params)
    const rows = (await rawQuery(
      `SELECT ev."dayOfWeek" AS day,
              ${hourExpr('ev."startDateTime"')} AS hour,
              CAST(COUNT(*) AS INTEGER) AS events,
              CAST(SUM(CASE WHEN ev."simultaneousGroupId" IS NOT NULL THEN 1 ELSE 0 END) AS INTEGER) AS simultaneous
       FROM "ScheduleEvent" ev
       WHERE ${cond}
       GROUP BY ev."dayOfWeek", hour`,
      ...params,
    )) as Array<{ day: number; hour: number; events: number; simultaneous: number }>

    const heatmap: HeatmapCell[][] = Array.from({ length: 7 }, (_, d) =>
      Array.from({ length: 24 }, (_, h) => ({
        day: d + 1,
        dayName: dayName(d + 1),
        hour: h,
        events: 0,
        simultaneous: 0,
      })),
    )
    for (const r of rows) {
      const d = Number(r.day)
      const h = Number(r.hour)
      if (d >= 1 && d <= 7 && h >= 0 && h < 24) {
        heatmap[d - 1][h].events = Number(r.events)
        heatmap[d - 1][h].simultaneous = Number(r.simultaneous)
      }
    }
    return heatmap
  })
}
