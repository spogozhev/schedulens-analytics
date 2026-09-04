// Shared color palette for charts (no indigo/blue per project style guide).
export const CHART_COLORS = {
  primary: '#ea580c',
  secondary: '#16a34a',
  accent: '#d97706',
  warning: '#dc2626',
  muted: '#71717a',
  info: '#0891b2',
  purple: '#a855f7',
  rose: '#e11d48',
  lime: '#65a30d',
  yellow: '#ca8a04',
}

// Sequential palette for multi-series / multi-bar charts.
export const SEQUENCE = [
  '#ea580c',
  '#16a34a',
  '#d97706',
  '#dc2626',
  '#ca8a04',
  '#65a30d',
  '#e11d48',
  '#9a3412',
]

export const DAY_NAMES_RU = [
  'Понедельник',
  'Вторник',
  'Среда',
  'Четверг',
  'Пятница',
  'Суббота',
  'Воскресенье',
]

export const DAY_NAMES_RU_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

export const KIND_LABELS: Record<number, string> = {
  0: 'Индивидуальные',
  1: 'Регулярные',
  2: 'Сессия',
}

export function formatHours(h: number): string {
  if (h === 0) return '0 ч'
  if (h < 1) return `${Math.round(h * 60)} мин`
  return `${h.toFixed(1)} ч`
}

export function formatNumber(n: number): string {
  return new Intl.NumberFormat('ru-RU').format(n)
}

export function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })
}

export function formatTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('ru-RU', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  })
}
