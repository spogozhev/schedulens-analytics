import { create } from 'zustand'

export interface DashboardFilters {
  from: string | null
  to: string | null
  kindCode: string | 'all'
  includeCanceled: boolean
  granularity: 'day' | 'week'
}

interface DashboardState {
  filters: DashboardFilters
  setFilter: <K extends keyof DashboardFilters>(key: K, value: DashboardFilters[K]) => void
  resetFilters: () => void
  setRange: (from: string | null, to: string | null) => void
  selectedTeacherId: number | null
  selectedRoomId: number | null
  setSelectedTeacher: (id: number | null) => void
  setSelectedRoom: (id: number | null) => void
}

const DEFAULTS: DashboardFilters = {
  from: null,
  to: null,
  kindCode: 'all',
  includeCanceled: false,
  granularity: 'week',
}

export const useDashboardStore = create<DashboardState>((set) => ({
  filters: { ...DEFAULTS },
  setFilter: (key, value) => set((s) => ({ filters: { ...s.filters, [key]: value } })),
  resetFilters: () => set({ filters: { ...DEFAULTS } }),
  setRange: (from, to) => set((s) => ({ filters: { ...s.filters, from, to } })),
  selectedTeacherId: null,
  selectedRoomId: null,
  setSelectedTeacher: (id) => set({ selectedTeacherId: id, selectedRoomId: null }),
  setSelectedRoom: (id) => set({ selectedRoomId: id, selectedTeacherId: null }),
}))

/** Build URL query string for API requests from the current filters. */
export function buildFilterQuery(f: DashboardFilters): string {
  const p = new URLSearchParams()
  if (f.from) p.set('from', f.from)
  if (f.to) p.set('to', f.to)
  if (f.kindCode !== 'all') p.set('kindCode', f.kindCode)
  p.set('includeCanceled', f.includeCanceled ? 'true' : 'false')
  return p.toString()
}
