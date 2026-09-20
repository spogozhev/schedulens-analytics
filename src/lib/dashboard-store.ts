import { create } from 'zustand'

export interface DashboardFilters {
  /** Selected DateRange ids; empty = all periods. */
  dateRangeIds: number[]
  /** Selected LessonForm ids; empty = all forms. */
  lessonFormIds: number[]
  kindCode: string | 'all'
  includeCanceled: boolean
  granularity: 'day' | 'week'
}

interface DashboardState {
  filters: DashboardFilters
  setFilter: <K extends keyof DashboardFilters>(key: K, value: DashboardFilters[K]) => void
  resetFilters: () => void
  setDateRanges: (ids: number[]) => void
  selectedTeacherId: number | null
  selectedRoomId: number | null
  setSelectedTeacher: (id: number | null) => void
  setSelectedRoom: (id: number | null) => void
}

const DEFAULTS: DashboardFilters = {
  dateRangeIds: [],
  lessonFormIds: [],
  kindCode: 'all',
  includeCanceled: false,
  granularity: 'week',
}

export const useDashboardStore = create<DashboardState>((set) => ({
  filters: { ...DEFAULTS },
  setFilter: (key, value) => set((s) => ({ filters: { ...s.filters, [key]: value } })),
  resetFilters: () => set({ filters: { ...DEFAULTS } }),
  setDateRanges: (ids) => set((s) => ({ filters: { ...s.filters, dateRangeIds: ids } })),
  selectedTeacherId: null,
  selectedRoomId: null,
  setSelectedTeacher: (id) => set({ selectedTeacherId: id, selectedRoomId: null }),
  setSelectedRoom: (id) => set({ selectedRoomId: id, selectedTeacherId: null }),
}))

/** Build URL query string for API requests from the current filters. */
export function buildFilterQuery(f: DashboardFilters): string {
  const p = new URLSearchParams()
  if (f.dateRangeIds.length > 0) p.set('dateRangeIds', f.dateRangeIds.join(','))
  if (f.lessonFormIds.length > 0) p.set('lessonFormIds', f.lessonFormIds.join(','))
  if (f.kindCode !== 'all') p.set('kindCode', f.kindCode)
  p.set('includeCanceled', f.includeCanceled ? 'true' : 'false')
  return p.toString()
}
