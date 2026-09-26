'use client'

import { useQuery } from '@tanstack/react-query'

const API_BASE = '/api/analytics'

async function fetchJson<T = any>(url: string): Promise<T> {
  const r = await fetch(url)
  if (!r.ok) {
    const text = await r.text().catch(() => '')
    throw new Error(`HTTP ${r.status}: ${text || r.statusText}`)
  }
  return r.json()
}

export function buildUrl(endpoint: string, query: string) {
  return `${API_BASE}/${endpoint}?${query}`
}

// ---------- Response types for the overview dashboard endpoints ----------

export interface KpisData {
  teachers: number
  events: number
  rooms: number
  subjects: number
  groups: number
  scheduledHours: number
  effectiveHours: number
  simultaneousEvents: number
  simultaneousGroups: number
  inferredEndEvents: number
  timeSavedHours: number
}

export interface ByKindItem {
  kindCode: number
  label: string
  count: number
}

/** Flat (month, kindCode) row — the client pivots it for the stacked chart. */
export interface ByMonthKindRow {
  month: number
  monthLabel: string
  kindCode: number
  count: number
}

export interface TopTeacherItem {
  id: number
  name: string
  longName: string
  events: number
  scheduledHours: number
  effectiveHours: number
  simultaneousGroups: number
}

export interface TopRoomItem {
  id: number
  name: string
  events: number
  uniqueLectures: number
  hours: number
  conflicts: number
}

export interface HeatmapCell {
  day: number
  dayName: string
  hour: number
  events: number
  simultaneous: number
}

export interface DateRangeItem {
  id: number
  displayText: string
  dateFrom: string
  dateTo: string
}

export interface LessonFormItem {
  id: number
  name: string
}

export interface MetaData {
  dateBounds: { from: string; to: string } | null
  filterOptions: { kinds: { kindCode: number; label: string }[] }
  dateRanges: DateRangeItem[]
  lessonForms: LessonFormItem[]
}

// ---------- Overview dashboard hooks (one query per dashboard section) ----------

export function useKpis(filters: string) {
  return useQuery({
    queryKey: ['kpi', filters],
    queryFn: () => fetchJson<{ kpis: KpisData }>(buildUrl('kpi', filters)),
  })
}

export function useByKind(filters: string) {
  return useQuery({
    queryKey: ['byKind', filters],
    queryFn: () => fetchJson<{ byKind: ByKindItem[] }>(buildUrl('by-kind', filters)),
  })
}

export interface ByLessonFormItem {
  id: number | null
  name: string
  count: number
}

export function useByLessonForm(filters: string) {
  return useQuery({
    queryKey: ['byLessonForm', filters],
    queryFn: () =>
      fetchJson<{ byLessonForm: ByLessonFormItem[] }>(buildUrl('by-lesson-form', filters)),
  })
}

export function useByMonthByKind(filters: string) {
  return useQuery({
    queryKey: ['byMonthByKind', filters],
    queryFn: () =>
      fetchJson<{ byMonthByKind: ByMonthKindRow[] }>(buildUrl('by-month-by-kind', filters)),
  })
}

export function useTopTeachers(filters: string, limit = 10) {
  return useQuery({
    queryKey: ['topTeachers', filters, limit],
    queryFn: () =>
      fetchJson<{ topTeachers: TopTeacherItem[] }>(buildUrl('top-teachers', `${filters}&limit=${limit}`)),
  })
}

export function useTopRooms(filters: string, limit = 10) {
  return useQuery({
    queryKey: ['topRooms', filters, limit],
    queryFn: () =>
      fetchJson<{ topRooms: TopRoomItem[] }>(buildUrl('top-rooms', `${filters}&limit=${limit}`)),
  })
}

export function useHeatmap(filters: string) {
  return useQuery({
    queryKey: ['heatmap', filters],
    queryFn: () => fetchJson<{ heatmap: HeatmapCell[][] }>(buildUrl('heatmap', filters)),
  })
}

/** Global metadata (date bounds, kind options) — filter-independent, cached once. */
export function useMeta() {
  return useQuery({
    queryKey: ['meta'],
    queryFn: () => fetchJson<MetaData>(`${API_BASE}/meta`),
  })
}

// ---------- Teachers / rooms lists and details ----------

export interface AddressItem {
  id: number
  displayName: string
  roomCount: number
}

export function useAddresses() {
  return useQuery({
    queryKey: ['addresses'],
    queryFn: () => fetchJson<{ addresses: AddressItem[] }>(`${API_BASE}/addresses`),
  })
}

export interface TopLevelUnitItem {
  id: number
  name: string
  educatorCount: number
}

export function useTopLevelUnits() {
  return useQuery({
    queryKey: ['topLevelUnits'],
    queryFn: () => fetchJson<{ topLevelUnits: TopLevelUnitItem[] }>(`${API_BASE}/top-level-units`),
  })
}

export interface PaginationParams {
  page: number
  pageSize: number
  sort: string
  search: string
}

/** Hour units for the teachers rating table (academic = astronomical × 4/3). */
export type HoursMode = 'astronomical' | 'academic'

export function useTeachers(filters: string, params: PaginationParams, hoursMode: HoursMode = 'astronomical') {
  const query = new URLSearchParams({
    ...(filters ? Object.fromEntries(new URLSearchParams(filters)) : {}),
    sort: params.sort,
    page: String(params.page),
    pageSize: String(params.pageSize),
    search: params.search,
    ...(hoursMode === 'academic' ? { hours: 'academic' } : {}),
  }).toString()
  return useQuery({
    queryKey: ['teachers', filters, params, hoursMode],
    queryFn: () => fetchJson(`${API_BASE}/teachers?${query}`),
    // Keep previous page's data while loading the next page (smoother UX).
    placeholderData: (prev) => prev,
  })
}

/**
 * URL of the .xlsx export of the teachers rating: the same filters, sort,
 * search and hour mode as useTeachers, but without pagination — the file
 * always contains every teacher matching the current filters.
 */
export function buildTeachersExportUrl(
  filters: string,
  params: Pick<PaginationParams, 'sort' | 'search'>,
  hoursMode: HoursMode = 'astronomical',
) {
  const query = new URLSearchParams({
    ...(filters ? Object.fromEntries(new URLSearchParams(filters)) : {}),
    sort: params.sort,
    search: params.search,
    ...(hoursMode === 'academic' ? { hours: 'academic' } : {}),
  }).toString()
  return `${API_BASE}/teachers/export?${query}`
}

export function useRooms(filters: string, params: PaginationParams) {
  const query = new URLSearchParams({
    ...(filters ? Object.fromEntries(new URLSearchParams(filters)) : {}),
    sort: params.sort,
    page: String(params.page),
    pageSize: String(params.pageSize),
    search: params.search,
  }).toString()
  return useQuery({
    queryKey: ['rooms', filters, params],
    queryFn: () => fetchJson(`${API_BASE}/rooms?${query}`),
    placeholderData: (prev) => prev,
  })
}

export interface TimelineBucket {
  key: string
  events: number
  scheduledMinutes: number
  effectiveMinutes: number
}

export function useTimeline(filters: string, granularity: 'day' | 'week') {
  return useQuery({
    queryKey: ['timeline', filters, granularity],
    queryFn: () =>
      fetchJson<{ granularity: 'day' | 'week'; timeline: TimelineBucket[] }>(
        buildUrl('timeline', `${filters}&granularity=${granularity}`),
      ),
  })
}

export function useTeacherDetail(id: number | null, filters: string) {
  return useQuery({
    enabled: id != null,
    queryKey: ['teacher', id, filters],
    queryFn: () => fetchJson(`${API_BASE}/teacher/${id}?${filters}`),
  })
}

/**
 * URL of the .xlsx export with the teacher's full event list: the same
 * filters as the teacher card, but every event instead of the recent-100
 * sample shown in the card.
 */
export function buildTeacherEventsExportUrl(id: number, filters: string) {
  return `${API_BASE}/teacher/${id}/export${filters ? `?${filters}` : ''}`
}

export function useRoomDetail(id: number | null, filters: string) {
  return useQuery({
    enabled: id != null,
    queryKey: ['room', id, filters],
    queryFn: () => fetchJson(`${API_BASE}/room/${id}?${filters}`),
  })
}
