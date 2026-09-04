'use client'

import * as React from 'react'
import {
  AlertTriangle,
  CalendarClock,
  Clock,
  MapPin,
  Users,
  XCircle,
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
import { DAY_NAMES_RU_SHORT, formatDateTime, formatHours, formatNumber, formatTime, KIND_LABELS } from './palette'
import { useDashboardStore, buildFilterQuery } from '@/lib/dashboard-store'
import { useRoomDetail } from '@/lib/api-hooks'

export function RoomDetailDialog() {
  const selectedRoomId = useDashboardStore((s) => s.selectedRoomId)
  const setSelectedRoom = useDashboardStore((s) => s.setSelectedRoom)
  const filters = useDashboardStore((s) => s.filters)
  const query = buildFilterQuery(filters)
  const { data, isLoading, error } = useRoomDetail(selectedRoomId, query)

  const open = selectedRoomId !== null
  const handleClose = () => setSelectedRoom(null)

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-hidden flex flex-col gap-0 p-0">
        <DialogHeader className="px-6 pt-6 pb-3 border-b">
          <DialogTitle className="flex items-center gap-3 text-lg">
            <MapPin className="h-5 w-5 text-amber-600 dark:text-amber-400" />
            {data ? data.name : 'Загрузка…'}
          </DialogTitle>
          <DialogDescription>
            {data?.latitude != null && data?.longitude != null && (
              <span className="text-muted-foreground">
                Координаты: {data.latitude.toFixed(5)}, {data.longitude.toFixed(5)}
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
            <div className="text-muted-foreground text-sm">Аудитория не найдена.</div>
          ) : (
            <div className="space-y-5">
              {/* KPIs */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                <Kpi icon={CalendarClock} label="Всего событий" value={formatNumber(data.kpis.eventsCount)} accent="primary" />
                <Kpi icon={Users} label="Уникальных лекций" value={formatNumber(data.kpis.uniqueLectures)} accent="secondary" />
                <Kpi icon={Clock} label="Часы загрузки" value={formatHours(data.kpis.hours)} accent="accent" />
                <Kpi icon={AlertTriangle} label="Конфликтов" value={formatNumber(data.kpis.conflicts)} accent="warning" />
                <Kpi icon={XCircle} label="Отменено" value={formatNumber(data.kpis.canceledLectures)} accent="warning" />
              </div>

              {data.kpis.conflicts > 0 && (
                <div className="flex items-center gap-2 text-xs text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 rounded-md px-3 py-2">
                  <AlertTriangle className="h-4 w-4" />
                  Обнаружено {data.kpis.conflicts} перекрытий во времени между разными лекциями в этой
                  аудитории.
                </div>
              )}

              {/* Charts */}
              <div className="grid gap-4 lg:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">По дням недели</CardTitle>
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

                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">По часу начала</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <LineChartCard
                      data={data.byHour
                        .filter((h: { hour: number; events: number }) => h.events > 0)
                        .map((h: { hour: number; events: number; minutes: number }) => ({
                          hour: `${String(h.hour).padStart(2, '0')}:00`,
                          events: h.events,
                          hours: Math.round((h.minutes / 60) * 10) / 10,
                        }))}
                      xKey="hour"
                      series={[{ key: 'hours', label: 'Часы', color: '#ea580c' }]}
                      height={220}
                    />
                  </CardContent>
                </Card>
              </div>

              {/* By subject & by educator */}
              <div className="grid gap-4 lg:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">Топ-10 дисциплин</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <BarChartCard
                      data={data.bySubject.map((s: { subject: string; hours: number }) => ({
                        name: s.subject.length > 32 ? s.subject.slice(0, 30) + '…' : s.subject,
                        hours: s.hours,
                      }))}
                      xKey="name"
                      series={[{ key: 'hours', label: 'Часы', color: '#16a34a' }]}
                      yFormatter={(v) => `${v} ч`}
                      height={260}
                    />
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">Топ-10 преподавателей</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <BarChartCard
                      data={data.byEducator.map((e: { educator: string; hours: number }) => ({
                        name: e.educator,
                        hours: e.hours,
                      }))}
                      xKey="name"
                      series={[{ key: 'hours', label: 'Часы', color: '#0891b2' }]}
                      yFormatter={(v) => `${v} ч`}
                      height={260}
                    />
                  </CardContent>
                </Card>
              </div>

              {/* Recent lectures */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Лекции в аудитории (последние 100, дедуплицировано)</CardTitle>
                  <CardDescription>
                    Каждая строка — отдельная физическая лекция (несколько преподавателей в одной лекции
                    объединены).
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
                          <TableHead>Преподаватель</TableHead>
                          <TableHead className="text-right">Групп</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {data.recentEvents.map((e: any) => (
                          <TableRow key={e.id}>
                            <TableCell className="text-sm tabular-nums">{formatDateTime(e.start)}</TableCell>
                            <TableCell className="text-sm tabular-nums">
                              {formatTime(e.start)}–{formatTime(e.end)}
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
                            </TableCell>
                            <TableCell className="text-sm">
                              <button
                                onClick={(ev) => {
                                  ev.stopPropagation()
                                  useDashboardStore.getState().setSelectedTeacher(e.educatorId)
                                }}
                                className="text-left hover:underline"
                                title={e.educatorLongName}
                              >
                                <div className="truncate max-w-[160px]">{e.educatorName}</div>
                                {e.coEducators.length > 0 && (
                                  <div className="text-xs text-muted-foreground">+ {e.coEducators.length} сотр.</div>
                                )}
                              </button>
                            </TableCell>
                            <TableCell className="text-right tabular-nums">{e.groups.length}</TableCell>
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
