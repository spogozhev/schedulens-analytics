'use client'

import * as React from 'react'
import {
  BookOpen,
  Building2,
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
import { CHART_COLORS, formatHours, formatNumber, KIND_COLORS } from './palette'
import { useDashboardStore, buildFilterQuery } from '@/lib/dashboard-store'
import { useOverview, useTimeline } from '@/lib/api-hooks'

export function OverviewTab() {
  const filters = useDashboardStore((s) => s.filters)
  const setSelectedTeacher = useDashboardStore((s) => s.setSelectedTeacher)
  const setSelectedRoom = useDashboardStore((s) => s.setSelectedRoom)
  const query = buildFilterQuery(filters)
  const { data, isLoading, error } = useOverview(query)
  const { data: tlData, isLoading: tlLoading } = useTimeline(query, filters.granularity)

  if (isLoading) return <OverviewSkeleton />
  if (error) return <div className="text-destructive text-sm">Ошибка: {String(error.message)}</div>
  if (!data) return null

  const k = data.kpis
  const timelineData = (tlData?.timeline ?? []).map((b: { key: string; events: number; scheduledMinutes: number; effectiveMinutes: number }) => ({
    key: b.key,
    События: b.events,
    Запланировано_часов: Math.round((b.scheduledMinutes / 60) * 10) / 10,
    Эффективно_часов: Math.round((b.effectiveMinutes / 60) * 10) / 10,
  }))

  const byKindData = data.byKind.map((k: { kindCode: number; label: string; count: number }) => ({
    name: k.label,
    value: k.count,
    color: KIND_COLORS[k.kindCode] ?? CHART_COLORS.muted,
  }))

  // Stacked-by-month data: each row is { month, [kindLabel]: count }.
  // The API returns byMonthByKind as a flat array of { month, [label]: count }
  // — it's already shaped for direct use in a stacked BarChartCard.
  const byMonthByKindData = (data.byMonthByKind ?? []) as Array<Record<string, number | string>>

  // Series for the stacked-by-month chart: one bar per kind, stacked.
  // Colors are matched to the pie chart via KIND_COLORS (by kindCode) so the
  // two charts stay visually consistent.
  const byMonthSeries = data.byKind.map((k: { kindCode: number; label: string }) => ({
    key: k.label,
    label: k.label,
    color: KIND_COLORS[k.kindCode] ?? CHART_COLORS.muted,
  }))

  const topTeachersData = data.topTeachers.map((t: { id: number; name: string; effectiveHours: number; scheduledHours: number }) => ({
    name: t.name,
    effectiveHours: t.effectiveHours,
    scheduledHours: t.scheduledHours,
  }))

  const topRoomsData = data.topRooms.map((r: { id: number; name: string; hours: number }) => ({
    name: r.name.length > 32 ? r.name.slice(0, 30) + '…' : r.name,
    hours: r.hours,
  }))

  return (
    <div className="space-y-6">
      {/* KPI grid */}
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

      {/* Simultaneous-classes banner */}
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

      {/* Charts grid */}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Динамика занятий</CardTitle>
            <CardDescription>
              Запланированные и эффективные часы по {filters.granularity === 'day' ? 'дням' : 'неделям'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {tlLoading ? (
              <Skeleton className="h-[260px] w-full" />
            ) : (
              <AreaChartCard
                data={timelineData}
                xKey="key"
                series={[
                  { key: 'Запланировано_часов', label: 'Запланировано, ч', color: CHART_COLORS.primary },
                  { key: 'Эффективно_часов', label: 'Эффективно, ч', color: CHART_COLORS.secondary },
                ]}
                height={280}
              />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">По типу занятий</CardTitle>
            <CardDescription>Распределение событий</CardDescription>
          </CardHeader>
          <CardContent>
            <PieChartCard data={byKindData} height={280} />
          </CardContent>
        </Card>
      </div>

      {/* Distribution by month — comparison across types */}
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
          <BarChartCard
            data={byMonthByKindData}
            xKey="month"
            series={byMonthSeries}
            yFormatter={(v) => formatNumber(v)}
            height={320}
            stacked
          />
        </CardContent>
      </Card>

      {/* Rankings */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Топ-10 преподавателей по нагрузке</CardTitle>
            <CardDescription>Эффективные часы с учётом одновременных занятий</CardDescription>
          </CardHeader>
          <CardContent>
            <BarChartCard
              data={topTeachersData}
              xKey="name"
              series={[
                { key: 'effectiveHours', label: 'Эффективно, ч', color: CHART_COLORS.secondary },
                { key: 'scheduledHours', label: 'Запланировано, ч', color: CHART_COLORS.primary },
              ]}
              yFormatter={(v) => `${v} ч`}
              height={420}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Топ-10 аудиторий по загрузке</CardTitle>
            <CardDescription>Уникальные лекции (дедуплицировано)</CardDescription>
          </CardHeader>
          <CardContent>
            <BarChartCard
              data={topRoomsData}
              xKey="name"
              series={[{ key: 'hours', label: 'Часы', color: CHART_COLORS.accent }]}
              yFormatter={(v) => `${v} ч`}
              height={420}
            />
          </CardContent>
        </Card>
      </div>

      {/* Heatmap */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Тепловая карта занятий</CardTitle>
          <CardDescription>
            Количество событий по дню недели и часу. Появление числа в ячейке = занятие в это время.
            Цвет отражает плотность.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Heatmap data={tlData?.heatmap ?? []} height={250} />
        </CardContent>
      </Card>

      {/* Top teachers quick links */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Быстрый доступ — преподаватели</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 max-h-[640px] overflow-y-auto custom-scrollbar">
            {data.topTeachers.map((t: { id: number; name: string; longName: string; effectiveHours: number; events: number; simultaneousGroups: number }) => (
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
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Быстрый доступ — аудитории</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 max-h-[640px] overflow-y-auto custom-scrollbar">
            {data.topRooms.map((r: { id: number; name: string; events: number; uniqueLectures: number; hours: number; conflicts: number }) => (
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
        </Card>
      </div>
    </div>
  )
}

function OverviewSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-[110px] w-full" />
        ))}
      </div>
      <Skeleton className="h-[120px] w-full" />
      <div className="grid gap-6 lg:grid-cols-3">
        <Skeleton className="h-[360px] lg:col-span-2" />
        <Skeleton className="h-[360px]" />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Skeleton className="h-[360px]" />
        <Skeleton className="h-[360px]" />
      </div>
      <Skeleton className="h-[280px] w-full" />
    </div>
  )
}
