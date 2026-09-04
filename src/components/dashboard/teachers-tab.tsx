'use client'

import * as React from 'react'
import { Layers, Search } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { MiniBar } from './charts'
import { formatHours, formatNumber } from './palette'
import { useDashboardStore, buildFilterQuery } from '@/lib/dashboard-store'
import { useTeachers } from '@/lib/api-hooks'

type SortKey = 'effectiveHours' | 'scheduledHours' | 'eventsCount' | 'simultaneousGroups' | 'simultaneousEvents' | 'name'

export function TeachersTab() {
  const filters = useDashboardStore((s) => s.filters)
  const setSelectedTeacher = useDashboardStore((s) => s.setSelectedTeacher)
  const [sort, setSort] = React.useState<SortKey>('effectiveHours')
  const [topN, setTopN] = React.useState(50)
  const [search, setSearch] = React.useState('')
  const query = buildFilterQuery(filters)
  const { data, isLoading, error } = useTeachers(query, sort, topN)

  const items = (data?.items ?? []).filter((t: { longName: string; name: string }) =>
    search.trim() === ''
      ? true
      : (t.longName || t.name).toLowerCase().includes(search.trim().toLowerCase()),
  )

  const maxEffective = Math.max(1, ...items.map((t: { effectiveHours: number }) => t.effectiveHours))
  const maxScheduled = Math.max(1, ...items.map((t: { scheduledHours: number }) => t.scheduledHours))

  return (
    <div className="space-y-4">
      {/* Controls */}
      <Card>
        <CardContent className="py-3 flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">Сортировка</span>
            <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
              <SelectTrigger className="w-[260px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="effectiveHours">Эффективные часы (с дедупликацией)</SelectItem>
                <SelectItem value="scheduledHours">Запланированные часы</SelectItem>
                <SelectItem value="eventsCount">Количество занятий</SelectItem>
                <SelectItem value="simultaneousGroups">Одновременных групп</SelectItem>
                <SelectItem value="simultaneousEvents">Одновременных событий</SelectItem>
                <SelectItem value="name">По фамилии (А→Я)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">Топ N</span>
            <Select value={String(topN)} onValueChange={(v) => setTopN(parseInt(v, 10))}>
              <SelectTrigger className="w-[120px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[10, 25, 50, 100, 200, 0].map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n === 0 ? 'Все' : `Топ ${n}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5 flex-1 min-w-[200px]">
            <span className="text-xs text-muted-foreground">Поиск по имени</span>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Фамилия или имя…"
                className="pl-8"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Рейтинг преподавателей</CardTitle>
          <CardDescription>
            Эффективные часы — это сумма интервалов времени преподавателя без двойного учёта
            одновременных занятий. Запланированные — это прямая сумма длительностей всех событий.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-[420px] w-full" />
          ) : error ? (
            <div className="text-destructive text-sm">Ошибка: {String(error.message)}</div>
          ) : items.length === 0 ? (
            <div className="text-sm text-muted-foreground py-8 text-center">Нет данных</div>
          ) : (
            <div className="max-h-[640px] overflow-y-auto custom-scrollbar rounded-md border border-border/60">
              <Table>
                <TableHeader className="sticky top-0 bg-card z-10">
                  <TableRow>
                    <TableHead className="w-[60px]">#</TableHead>
                    <TableHead className="min-w-[200px]">Преподаватель</TableHead>
                    <TableHead className="text-right">Занятий</TableHead>
                    <TableHead className="text-right">Эфф. часов</TableHead>
                    <TableHead className="text-right">Заплан. часов</TableHead>
                    <TableHead className="w-[200px]">Нагрузка (эфф.)</TableHead>
                    <TableHead className="text-right">Одновр. группы</TableHead>
                    <TableHead className="text-right">Одновр. событий</TableHead>
                    <TableHead className="text-right">Экономия, ч</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((t: any, i: number) => (
                    <TableRow
                      key={t.id}
                      onClick={() => setSelectedTeacher(t.id)}
                      className="cursor-pointer hover:bg-accent/40"
                    >
                      <TableCell className="text-muted-foreground tabular-nums">{i + 1}</TableCell>
                      <TableCell>
                        <div className="font-medium">{t.longName || t.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {t.inferredEndEvents > 0 && (
                            <span className="mr-2 text-amber-600 dark:text-amber-400">
                              ⚠ {t.inferredEndEvents} без конца
                            </span>
                          )}
                          {t.canceledEvents > 0 && (
                            <span className="text-red-600 dark:text-red-400">
                              ✕ {t.canceledEvents} отменено
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatNumber(t.eventsCount)}</TableCell>
                      <TableCell className="text-right tabular-nums font-medium">
                        {formatHours(t.effectiveHours)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {formatHours(t.scheduledHours)}
                      </TableCell>
                      <TableCell>
                        <MiniBar value={t.effectiveHours} max={maxEffective} color="#ea580c" />
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {t.simultaneousGroups > 0 ? (
                          <Badge variant="secondary" className="bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300">
                            <Layers className="h-3 w-3 mr-1" />
                            {formatNumber(t.simultaneousGroups)}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {t.simultaneousEvents > 0 ? formatNumber(t.simultaneousEvents) : '—'}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-emerald-600 dark:text-emerald-400">
                        {t.simultaneousTimeSavedHours > 0 ? formatHours(t.simultaneousTimeSavedHours) : '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
