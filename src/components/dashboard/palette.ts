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

// Color per kindCode. Used by the pie chart "По типу занятий" and the
// stacked bar chart "Распределение по месяцам по типам занятий" so both
// charts stay visually consistent.
//
// The three colors are chosen for high distinguishability while staying
// within the project's warm palette (no indigo/blue):
//   - Индивидуальные мероприятия (0): orange  (#ea580c) — same as
//     CHART_COLORS.primary, also used by the top-10 teachers chart
//   - Регулярные занятия (1):       green   (#16a34a) — primary bulk of the schedule
//   - Сессия / консультации (2):     amber   (#d97706) — warmer/longer wavelength
//
// The three colors form a triad in the warm green-orange range:
// green-600 (#16a34a), orange-600 (#ea580c), amber-600 (#d97706) — visually
// distinct yet harmonious.
export const KIND_COLORS: Record<number, string> = {
  0: '#ea580c', // orange-600 (rgb 234, 88, 12) — Индивидуальные мероприятия
  1: '#16a34a', // green-600 — Регулярные занятия
  2: '#d97706', // amber-600 — Сессия / консультации
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
