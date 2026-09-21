'use client'

import * as React from 'react'
import {
  CalendarClock,
  Clock,
  GraduationCap,
  Layers,
  MapPin,
  TimerReset,
  Users,
  XCircle,
  AlertTriangle,
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { BarChartCard, LineChartCard } from './charts'
import { DAY_NAMES_RU_SHORT, formatDateTime, formatHours, formatNumber, formatTime, KIND_LABELS, SEQUENCE } from './palette'
import { useDashboardStore, buildFilterQuery } from '@/lib/dashboard-store'
import { useTeacherDetail } from '@/lib/api-hooks'

export function TeacherDetailDialog() {
  const selectedTeacherId = useDashboardStore((s) => s.selectedTeacherId)
  const setSelectedTeacher = useDashboardStore((s) => s.setSelectedTeacher)
  const filters = useDashboardStore((s) => s.filters)
  const query = buildFilterQuery(filters)
  const { data, isLoading, error } = useTeacherDetail(selectedTeacherId, query)

  const open = selectedTeacherId !== null
  const handleClose = () => setSelectedTeacher(null)

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="sm:max-w-[800px] max-h-[90vh] overflow-hidden flex flex-col gap-0 p-0">
        <DialogHeader className="px-6 pt-6 pb-3 border-b">
          <DialogTitle className="flex items-center gap-3 text-lg">
            <GraduationCap className="h-5 w-5 text-orange-600 dark:text-orange-400" />
            {data ? data.longName : 'Загрузка…'}
          </DialogTitle>
          <DialogDescription>
            {data ? `ID ${data.id}` : ''}
            {data?.employments && data.employments.length > 0 && (
              <span className="mt-0.5 block">
                {data.employments
                  .map((e) => (e.department ? `${e.position}, ${e.department}` : e.position))
                  .join('; ')}
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="overflow-y-auto custom-scrollbar px-6 py-4 flex-1">
          {isLoading ? (
            <Skeleton className="h-[500px] w-full" />
          ) : error ? (
            <div className="text-destructive text-sm">Ошибка: {String(error.message)}</div>
          ) : !data ? (
            <div className="text-muted-foreground text-sm">Преподаватель не найден.</div>
          ) : (
            <div className="space-y-5">
              {/* KPIs */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                <Kpi icon={CalendarClock} label="Занятий" value={formatNumber(data.kpis.eventsCount)} accent="primary" />
                <Kpi icon={Clock} label="Эфф. часов" value={formatHours(data.kpis.effectiveHours)} accent="secondary" />
                <Kpi icon={Clock} label="Заплан. часов" value={formatHours(data.kpis.scheduledHours)} accent="primary" />
                <Kpi icon={Layers} label="Одновр. группы" value={formatNumber(data.kpis.simultaneousGroups)} accent="accent" />
                <Kpi icon={TimerReset} label="Экономия, ч" value={formatHours(data.kpis.timeSavedHours)} accent="secondary" />
                <Kpi icon={XCircle} label="Отменено" value={formatNumber(data.kpis.canceledEvents)} accent="warning" />
              </div>

              {data.kpis.inferredEndEvents > 0 && (
                <div className="flex items-center gap-2 text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 rounded-md px-3 py-2">
                  <AlertTriangle className="h-4 w-4" />
                  {data.kpis.inferredEndEvents} занятий без указанного окончания — длительность
                  установлена в 1 ч 30 мин по умолчанию.
                </div>
              )}

              {/* Charts */}
              <div className="grid gap-4 lg:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">Занятия по неделям</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <LineChartCard
                      data={data.byWeek.map((w: { week: string; events: number; minutes: number }) => ({
                        week: w.week.replace('-W', '·Н'),
                        events: w.events,
                        hours: Math.round((w.minutes / 60) * 10) / 10,
                      }))}
                      xKey="week"
                      series={[
                        { key: 'hours', label: 'Часы', color: '#ea580c' },
                        { key: 'events', label: 'События', color: '#16a34a' },
                      ]}
                      height={220}
                    />
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">Распределение по дням недели</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <BarChartCard
                      data={data.byDayOfWeek.map((d: { day: number; dayName: string; events: number; minutes: number }) => ({
                        name: DAY_NAMES_RU_SHORT[d.day - 1],
                        events: d.events,
                        hours: Math.round((d.minutes / 60) * 10) / 10,
                      }))}
                      xKey="name"
                      series={[{ key: 'hours', label: 'Часы', color: '#d97706' }]}
                      yFormatter={(v) => `${v} ч`}
                      height={220}
                    />
                  </CardContent>
                </Card>
              </div>

              {/* Top subjects */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Топ-10 дисциплин</CardTitle>
                </CardHeader>
                <CardContent>
                  <BarChartCard
                    data={data.bySubject.map((s: { subject: string; events: number; hours: number }) => ({
                      name: s.subject.length > 40 ? s.subject.slice(0, 38) + '…' : s.subject,
                      hours: s.hours,
                    }))}
                    xKey="name"
                    series={[{ key: 'hours', label: 'Часы', color: '#0891b2' }]}
                    yFormatter={(v) => `${v} ч`}
                    height={280}
                  />
                </CardContent>
              </Card>

              {/* Simultaneous groups highlight */}
              {data.simultaneousGroups.length > 0 && (
                <Card className="border-orange-500/30">
                  <CardHeader>
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Layers className="h-4 w-4 text-orange-600 dark:text-orange-400" />
                      Одновременные события (показано {data.simultaneousGroups.length} из {data.kpis.simultaneousGroups})
                    </CardTitle>
                    <CardDescription>
                      Каждый блок — это время, когда преподаватель ведёт несколько занятий одновременно
                      (например, потоковую лекцию для нескольких групп).
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3 max-h-[400px] overflow-y-auto custom-scrollbar">
                    {data.simultaneousGroups.map((g: any, idx: number) => (
                      <div key={g.id} className="border border-orange-500/30 rounded-md p-3 bg-orange-50/40 dark:bg-orange-950/20">
                        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
                          <div className="text-sm font-medium">
                            {idx + 1}. {formatDateTime(g.start)} → {formatTime(g.end)}
                          </div>
                          <Badge variant="secondary" className="bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300">
                            Эффективно {g.effectiveMinutes} мин · {g.events.length} события
                          </Badge>
                        </div>
                        <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
                          {g.events.map((e: any) => (
                            <div key={e.id} className="text-xs border rounded p-2 bg-card">
                              <div className="font-medium truncate">{e.subject}</div>
                              <div className="text-muted-foreground">
                                {formatTime(e.start)}–{formatTime(e.end)}
                              </div>
                              {e.locations[0] && (
                                <div className="flex items-center gap-1 text-muted-foreground truncate">
                                  <MapPin className="h-3 w-3 shrink-0" />
                                  <span className="truncate">{e.locations[0]}</span>
                                </div>
                              )}
                              {e.groups.length > 0 && (
                                <div className="flex items-center gap-1 text-muted-foreground truncate">
                                  <Users className="h-3 w-3 shrink-0" />
                                  <span className="truncate">{e.groups.length} групп</span>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}

              {/* Recent events */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Последние занятия (макс. 100)</CardTitle>
                  <CardDescription>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="inline-block h-2 w-2 rounded-full bg-orange-500" />
                      подсвечены события, входящие в одновременную группу
                    </span>
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="max-h-[400px] overflow-y-auto custom-scrollbar rounded-md border border-border/60">
                    <Table>
                      <TableHeader className="sticky top-0 bg-card z-10">
                        <TableRow>
                          <TableHead>Дата</TableHead>
                          <TableHead>Время</TableHead>
                          <TableHead>Дисциплина</TableHead>
                          <TableHead>Тип</TableHead>
                          <TableHead>Аудитория</TableHead>
                          <TableHead className="text-right">Групп</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {data.recentEvents.map((e: any) => (
                          <TableRow
                            key={e.id}
                            className={e.simultaneousGroupId ? 'bg-orange-50/40 dark:bg-orange-950/15' : ''}
                          >
                            <TableCell className="text-sm tabular-nums">
                              {formatDateTime(e.start)}
                            </TableCell>
                            <TableCell className="text-sm tabular-nums">
                              {e.rawStart}–{e.rawEnd ?? `${e.rawStart}+90м`}
                              {e.hasInferredEnd && (
                                <span className="ml-1 text-xs text-amber-600 dark:text-amber-400" title="Окончание не указано, по умолчанию +1ч30м">
                                  ⚠
                                </span>
                              )}
                            </TableCell>
                            <TableCell className="text-sm">
                              <div className="font-medium truncate max-w-[280px]" title={e.subject}>
                                {e.subject}
                              </div>
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" className="font-normal">
                                {KIND_LABELS[e.kindCode] ?? `Тип ${e.kindCode}`}
                              </Badge>
                              {e.isCanceled && (
                                <Badge variant="secondary" className="ml-1 bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300">
                                  Отменено
                                </Badge>
                              )}
                              {e.simultaneousGroupId && (
                                <Badge variant="secondary" className="ml-1 bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300">
                                  <Layers className="h-3 w-3 mr-1" />
                                  Одновр.
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground truncate max-w-[200px]" title={e.locations.join(', ')}>
                              {e.locations[0] ?? '—'}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {e.groups.length}
                              {e.coEducators.length > 0 && (
                                <span className="ml-1 text-xs text-cyan-600 dark:text-cyan-400" title={`Со-преподаватели: ${e.coEducators.join(', ')}`}>
                                  +{e.coEducators.length} сотр.
                                </span>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function Kpi({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: React.ReactNode
  accent: 'primary' | 'secondary' | 'accent' | 'warning'
}) {
  const color = {
    primary: 'text-orange-600 dark:text-orange-400',
    secondary: 'text-emerald-600 dark:text-emerald-400',
    accent: 'text-amber-600 dark:text-amber-400',
    warning: 'text-red-600 dark:text-red-400',
  }[accent]
  return (
    <div className="border rounded-lg p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{label}</span>
        <Icon className={`h-4 w-4 ${color}`} />
      </div>
      <div className={`mt-1 text-xl font-bold tabular-nums ${color}`}>{value}</div>
    </div>
  )
}
