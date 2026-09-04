'use client'

import { useQuery } from '@tanstack/react-query'

const API_BASE = '/api/analytics'

async function fetchJson(url: string) {
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

export function useOverview(filters: string) {
  return useQuery({
    queryKey: ['overview', filters],
    queryFn: () => fetchJson(buildUrl('overview', filters)),
  })
}

export interface PaginationParams {
  page: number
  pageSize: number
  sort: string
  search: string
}

export function useTeachers(filters: string, params: PaginationParams) {
  const query = new URLSearchParams({
    ...(filters ? Object.fromEntries(new URLSearchParams(filters)) : {}),
    sort: params.sort,
    page: String(params.page),
    pageSize: String(params.pageSize),
    search: params.search,
  }).toString()
  return useQuery({
    queryKey: ['teachers', filters, params],
    queryFn: () => fetchJson(`${API_BASE}/teachers?${query}`),
    // Keep previous page's data while loading the next page (smoother UX).
    placeholderData: (prev) => prev,
  })
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

export function useTimeline(filters: string, granularity: 'day' | 'week') {
  return useQuery({
    queryKey: ['timeline', filters, granularity],
    queryFn: () => fetchJson(`${API_BASE}/timeline?${filters}&granularity=${granularity}`),
  })
}

export function useTeacherDetail(id: number | null, filters: string) {
  return useQuery({
    enabled: id != null,
    queryKey: ['teacher', id, filters],
    queryFn: () => fetchJson(`${API_BASE}/teacher/${id}?${filters}`),
  })
}

export function useRoomDetail(id: number | null, filters: string) {
  return useQuery({
    enabled: id != null,
    queryKey: ['room', id, filters],
    queryFn: () => fetchJson(`${API_BASE}/room/${id}?${filters}`),
  })
}
