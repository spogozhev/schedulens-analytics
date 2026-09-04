'use client'

import * as React from 'react'
import { AlertTriangle, Search, TimerReset } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
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
import { useRooms } from '@/lib/api-hooks'

type SortKey = 'hours' | 'events' | 'uniqueLectures' | 'conflicts' | 'name'

export function RoomsTab() {
  const filters = useDashboardStore((s) => s.filters)
  const setSelectedRoom = useDashboardStore((s) => s.setSelectedRoom)
  const [sort, setSort] = React.useState<SortKey>('hours')
  const [topN, setTopN] = React.useState(50)
  const [search, setSearch] = React.useState('')
  const query = buildFilterQuery(filters)
  const { data, isLoading, error } = useRooms(query, sort, topN)

  const items = (data?.items ?? []).filter((r: { name: string }) =>
    search.trim() === '' ? true : r.name.toLowerCase().includes(search.trim().toLowerCase()),
  )

  const maxHours = Math.max(1, ...items.map((r: { hours: number }) => r.hours))

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="py-3 flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">Сортировка</span>
            <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
              <SelectTrigger className="w-[260px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="hours">Часы загрузки</SelectItem>
                <SelectItem value="events">Количество событий</SelectItem>
                <SelectItem value="uniqueLectures">Уникальных лекций</SelectItem>
                <SelectItem value="conflicts">Конфликты бронирования</SelectItem>
                <SelectItem value="name">По названию (А→Я)</SelectItem>
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
            <span className="text-xs text-muted-foreground">Поиск по адресу</span>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Адрес аудитории…"
                className="pl-8"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Рейтинг аудиторий</CardTitle>
          <CardDescription>
            Часы загрузки — это сумма длительностей <span className="font-medium">уникальных лекций</span> в
            аудитории. Если несколько преподавателей ведут одно занятие (одна физическая лекция), она
            учитывается один раз.
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
                    <TableHead className="min-w-[260px]">Аудитория</TableHead>
                    <TableHead className="text-right">Всего событий</TableHead>
                    <TableHead className="text-right">Уникальных лекций</TableHead>
                    <TableHead className="text-right">Часы загрузки</TableHead>
                    <TableHead className="w-[200px]">Загрузка</TableHead>
                    <TableHead className="text-right">Конфликтов</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((r: any, i: number) => (
                    <TableRow
                      key={r.id}
                      onClick={() => setSelectedRoom(r.id)}
                      className="cursor-pointer hover:bg-accent/40"
                    >
                      <TableCell className="text-muted-foreground tabular-nums">{i + 1}</TableCell>
                      <TableCell>
                        <div className="font-medium">{r.name}</div>
                        {r.latitude != null && r.longitude != null && (
                          <div className="text-xs text-muted-foreground">
                            📍 {r.latitude.toFixed(5)}, {r.longitude.toFixed(5)}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatNumber(r.eventsCount)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatNumber(r.uniqueLectures)}</TableCell>
                      <TableCell className="text-right tabular-nums font-medium">{formatHours(r.hours)}</TableCell>
                      <TableCell>
                        <MiniBar value={r.hours} max={maxHours} color="#d97706" />
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {r.conflicts > 0 ? (
                          <Badge variant="secondary" className="bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300">
                            <AlertTriangle className="h-3 w-3 mr-1" />
                            {formatNumber(r.conflicts)}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
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
