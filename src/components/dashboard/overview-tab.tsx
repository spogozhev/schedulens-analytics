'use client'

import * as React from 'react'
import type { UseQueryResult } from '@tanstack/react-query'
import {
  BookOpen,
  CalendarClock,
  Clock,
  GraduationCap,
  Layers,
  MapPin,
  TimerReset,
  Users,
  Zap,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { KpiCard } from './kpi-card'
import { AreaChartCard, BarChartCard, Heatmap, PieChartCard } from './charts'
import { CHART_COLORS, formatHours, formatNumber, KIND_COLORS, KIND_LABELS_LONG } from './palette'
import { useDashboardStore, buildFilterQuery } from '@/lib/dashboard-store'
import {
  useKpis,
  useByKind,
  useByLessonForm,
  useByMonthByKind,
  useTopTeachers,
  useTopRooms,
  useHeatmap,
  useTimeline,
  type KpisData,
  type ByMonthKindRow,
} from '@/lib/api-hooks'

/**
 * Renders one dashboard section from its own react-query result: a skeleton
 * while loading, an inline error on failure, the section content otherwise.
 * Each overview card is fed by its own endpoint, so sections appear
 * progressively and a failure in one doesn't blank the whole tab.
 */
function QuerySection<T>({
  query,
  skeleton,
  children,
}: {
  query: UseQueryResult<T>
  skeleton: React.ReactNode
  children: (data: T) => React.ReactNode
}) {
  if (query.isLoading) return <>{skeleton}</>
  if (query.error) {
    return <div className="text-destructive text-sm">Ошибка: {String(query.error.message)}</div>
  }
  if (!query.data) return null
  return <>{children(query.data)}</>
}

function ChartSkeleton({ height }: { height: number }) {
  return <Skeleton style={{ height }} className="w-full" />
}

// Series for the stacked-by-month chart: one bar per kind, stacked.
// Colors are matched to the pie chart via KIND_COLORS (by kindCode) so the
// two charts stay visually consistent.
const BY_MONTH_SERIES = Object.entries(KIND_LABELS_LONG).map(([code, label]) => ({
  key: label,
  label,
  color: KIND_COLORS[Number(code)] ?? CHART_COLORS.muted,
}))

/**
 * Pivot flat (month, kindCode) rows into one object per month with a numeric
 * field per kind label — the shape BarChartCard expects for stacked bars.
 * The API returns rows sorted by month; we sort defensively anyway.
 */
function pivotByMonthStacked(rows: ByMonthKindRow[]): Array<Record<string, number | string>> {
  const sorted = [...rows].sort((a, b) => a.month - b.month)
  const byMonth = new Map<number, Record<string, number | string>>()
  const stacked: Array<Record<string, number | string>> = []
  for (const r of sorted) {
    let row = byMonth.get(r.month)
    if (!row) {
      row = { month: r.monthLabel }
      byMonth.set(r.month, row)
      stacked.push(row)
    }
    row[KIND_LABELS_LONG[r.kindCode] ?? `Тип ${r.kindCode}`] = r.count
  }
  // Fill zeros for kinds with no events in a month so the stack stays consistent.
  for (const row of stacked) {
    for (const label of Object.values(KIND_LABELS_LONG)) {
      if (typeof row[label] !== 'number') row[label] = 0
    }
  }
  return stacked
}

export function OverviewTab() {
  const filters = useDashboardStore((s) => s.filters)
  const setSelectedTeacher = useDashboardStore((s) => s.setSelectedTeacher)
  const setSelectedRoom = useDashboardStore((s) => s.setSelectedRoom)
  const query = buildFilterQuery(filters)

  // One request per dashboard section (see src/app/api/analytics/*).
  const kpisQ = useKpis(query)
  const byKindQ = useByKind(query)
  const byLessonFormQ = useByLessonForm(query)
  const byMonthQ = useByMonthByKind(query)
  const topTeachersQ = useTopTeachers(query)
  const topRoomsQ = useTopRooms(query)
  const timelineQ = useTimeline(query, filters.granularity)
  const heatmapQ = useHeatmap(query)

  return (
    <div className="space-y-6">
      {/* KPI grid + simultaneous-classes banner (single /kpi request) */}
      <QuerySection
        query={kpisQ}
        skeleton={
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-[110px] w-full" />
              ))}
            </div>
            <Skeleton className="h-[120px] w-full" />
          </>
        }
      >
        {({ kpis: k }) => (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
              <KpiCard
                title="Преподавателей"
                value={formatNumber(k.teachers)}
                hint="В выборке с занятиями"
                icon={GraduationCap}
                accent="primary"
              />
              <KpiCard
                title="Всего занятий"
                value={formatNumber(k.events)}
                hint="Событий расписания"
                icon={CalendarClock}
                accent="secondary"
              />
              <KpiCard
                title="Аудиторий"
                value={formatNumber(k.rooms)}
                hint="Задействованных помещений"
                icon={MapPin}
                accent="accent"
              />
              <KpiCard
                title="Дисциплин"
                value={formatNumber(k.subjects)}
                hint="Уникальных предметов"
                icon={BookOpen}
                accent="info"
              />
              <KpiCard
                title="Групп"
                value={formatNumber(k.groups)}
                hint="Учебных потоков / групп"
                icon={Users}
                accent="muted"
              />
              <KpiCard
                title="Запланировано часов"
                value={formatHours(k.scheduledHours)}
                hint={`Эффективно: ${formatHours(k.effectiveHours)}`}
                icon={Clock}
                accent="primary"
              />
            </div>

            <Card className="border-orange-500/30 bg-orange-50/50 dark:bg-orange-950/20">
              <CardContent className="py-4">
                <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
                  <div className="flex items-center gap-3">
                    <div className="rounded-md bg-orange-500/15 p-2 text-orange-600 dark:text-orange-400">
                      <Layers className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="text-sm font-medium">Одновременные занятия</div>
                      <div className="text-xs text-muted-foreground">
                        Классы, где преподаватель ведёт несколько групп сразу
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 text-sm">
                    <div>
                      <span className="text-2xl font-bold tabular-nums text-orange-600 dark:text-orange-400">
                        {formatNumber(k.simultaneousGroups)}
                      </span>{' '}
                      <span className="text-muted-foreground">групп</span>
                    </div>
                    <div>
                      <span className="text-2xl font-bold tabular-nums text-orange-600 dark:text-orange-400">
                        {formatNumber(k.simultaneousEvents)}
                      </span>{' '}
                      <span className="text-muted-foreground">событий</span>
                    </div>
                    <div>
                      <span className="text-2xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
                        {formatHours(k.timeSavedHours)}
                      </span>{' '}
                      <span className="text-muted-foreground">сэкономлено (разница)</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground ml-auto">
                    <Zap className="h-4 w-4" />
                    <span>
                      Эффективная нагрузка = {formatHours(k.effectiveHours)} из {formatHours(k.scheduledHours)} (дедупликация по времени)
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </QuerySection>

      {/* Dynamics of classes — full-width chart (from /timeline) */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Динамика занятий</CardTitle>
          <CardDescription>
            Запланированные и эффективные часы по {filters.granularity === 'day' ? 'дням' : 'неделям'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <QuerySection query={timelineQ} skeleton={<ChartSkeleton height={260} />}>
            {(tl) => {
              const timelineData = tl.timeline.map((b) => ({
                key: b.key,
                События: b.events,
                Запланировано_часов: Math.round((b.scheduledMinutes / 60) * 10) / 10,
                Эффективно_часов: Math.round((b.effectiveMinutes / 60) * 10) / 10,
              }))
              return (
                <AreaChartCard
                  data={timelineData}
                  xKey="key"
                  series={[
                    { key: 'Запланировано_часов', label: 'Запланировано, ч', color: CHART_COLORS.primary },
                    { key: 'Эффективно_часов', label: 'Эффективно, ч', color: CHART_COLORS.secondary },
                  ]}
                  height={280}
                />
              )
            }}
          </QuerySection>
        </CardContent>
      </Card>

      {/* Row: by-kind pie (1/3 width) + lesson-form distribution (2/3 width) */}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">По типу занятий</CardTitle>
            <CardDescription>Распределение событий</CardDescription>
          </CardHeader>
          <CardContent>
            <QuerySection query={byKindQ} skeleton={<ChartSkeleton height={340} />}>
              {(d) => (
                <PieChartCard
                  data={d.byKind.map((k) => ({
                    name: k.label,
                    value: k.count,
                    color: KIND_COLORS[k.kindCode] ?? CHART_COLORS.muted,
                  }))}
                  height={340}
                />
              )}
            </QuerySection>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">По формам занятий</CardTitle>
            <CardDescription>Распределение событий по форме проведения</CardDescription>
          </CardHeader>
          <CardContent>
            <QuerySection query={byLessonFormQ} skeleton={<ChartSkeleton height={340} />}>
              {(d) => (
                <BarChartCard
                  // Ascending order: recharts plots the first category at the
                  // bottom, so the largest bar ends up on top.
                  data={d.byLessonForm
                    .map((f) => ({ name: f.name, count: f.count }))
                    .sort((a, b) => a.count - b.count)}
                  xKey="name"
                  series={[{ key: 'count', label: 'Событий' }]}
                  yFormatter={(v) => formatNumber(v)}
                  height={340}
                  horizontal
                  yWidth={250}
                />
              )}
            </QuerySection>
          </CardContent>
        </Card>
      </div>

      {/* Distribution by month — comparison across types (from /by-month-by-kind) */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Распределение по месяцам по типам занятий</CardTitle>
          <CardDescription>
            Количество событий в каждом месяце, разложенное по типам. Видно,
            когда проходят регулярные занятия (по всему семестру) и когда
            наступает сессия (пик в мае–июне). Столбцы наложены (stacked) —
            высота итогового столбца равна общему числу событий в месяце.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <QuerySection query={byMonthQ} skeleton={<ChartSkeleton height={320} />}>
            {(d) => (
              <BarChartCard
                data={pivotByMonthStacked(d.byMonthByKind)}
                xKey="month"
                series={BY_MONTH_SERIES}
                yFormatter={(v) => formatNumber(v)}
                height={320}
                stacked
                rotateX={false}
              />
            )}
          </QuerySection>
        </CardContent>
      </Card>

      {/* Rankings (from /top-teachers and /top-rooms) */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Топ-10 преподавателей по нагрузке</CardTitle>
            <CardDescription>Эффективные часы с учётом одновременных занятий</CardDescription>
          </CardHeader>
          <CardContent>
            <QuerySection query={topTeachersQ} skeleton={<ChartSkeleton height={420} />}>
              {(d) => (
                <BarChartCard
                  data={d.topTeachers.map((t) => ({
                    name: t.name,
                    effectiveHours: t.effectiveHours,
                    scheduledHours: t.scheduledHours,
                  }))}
                  xKey="name"
                  series={[
                    { key: 'effectiveHours', label: 'Эффективно, ч', color: CHART_COLORS.secondary },
                    { key: 'scheduledHours', label: 'Запланировано, ч', color: CHART_COLORS.primary },
                  ]}
                  yFormatter={(v) => `${v} ч`}
                  height={420}
                />
              )}
            </QuerySection>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Топ-10 аудиторий по загрузке</CardTitle>
            <CardDescription>Уникальные лекции (дедуплицировано)</CardDescription>
          </CardHeader>
          <CardContent>
            <QuerySection query={topRoomsQ} skeleton={<ChartSkeleton height={420} />}>
              {(d) => (
                <BarChartCard
                  data={d.topRooms.map((r) => ({
                    name: r.name.length > 32 ? r.name.slice(0, 30) + '…' : r.name,
                    hours: r.hours,
                  }))}
                  xKey="name"
                  series={[{ key: 'hours', label: 'Часы', color: CHART_COLORS.accent }]}
                  yFormatter={(v) => `${v} ч`}
                  height={420}
                />
              )}
            </QuerySection>
          </CardContent>
        </Card>
      </div>

      {/* Heatmap (from /heatmap) */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Тепловая карта занятий</CardTitle>
          <CardDescription>
            Количество событий по дню недели и часу. Появление числа в ячейке = занятие в это время.
            Цвет отражает плотность.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <QuerySection query={heatmapQ} skeleton={<ChartSkeleton height={350} />}>
            {(d) => <Heatmap data={d.heatmap} height={350} />}
          </QuerySection>
        </CardContent>
      </Card>

      {/* Top teachers quick links (same /top-teachers data as the chart above) */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Быстрый доступ — преподаватели</CardTitle>
          </CardHeader>
          <QuerySection
            query={topTeachersQ}
            skeleton={
              <CardContent className="space-y-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-[68px] w-full" />
                ))}
              </CardContent>
            }
          >
            {(d) => (
              <CardContent className="space-y-2 max-h-[640px] overflow-y-auto custom-scrollbar">
                {d.topTeachers.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setSelectedTeacher(t.id)}
                    className="w-full text-left p-3 rounded-lg border border-border/60 hover:bg-accent/50 hover:border-primary/40 transition-colors"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-medium truncate">{t.longName}</div>
                        <div className="text-xs text-muted-foreground">
                          {formatNumber(t.events)} занятий · {formatHours(t.effectiveHours)} эффективных
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-1 justify-end">
                        {t.simultaneousGroups > 0 && (
                          <Badge variant="secondary" className="bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300">
                            <Layers className="h-3 w-3 mr-1" />
                            {t.simultaneousGroups}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </button>
                ))}
              </CardContent>
            )}
          </QuerySection>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Быстрый доступ — аудитории</CardTitle>
          </CardHeader>
          <QuerySection
            query={topRoomsQ}
            skeleton={
              <CardContent className="space-y-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-[68px] w-full" />
                ))}
              </CardContent>
            }
          >
            {(d) => (
              <CardContent className="space-y-2 max-h-[640px] overflow-y-auto custom-scrollbar">
                {d.topRooms.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => setSelectedRoom(r.id)}
                    className="w-full text-left p-3 rounded-lg border border-border/60 hover:bg-accent/50 hover:border-primary/40 transition-colors"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-medium truncate">{r.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {formatNumber(r.uniqueLectures)} лекций · {formatHours(r.hours)} часов
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        {r.conflicts > 0 && (
                          <Badge variant="secondary" className="bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300">
                            <TimerReset className="h-3 w-3 mr-1" />
                            {r.conflicts}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </button>
                ))}
              </CardContent>
            )}
          </QuerySection>
        </Card>
      </div>
    </div>
  )
}
