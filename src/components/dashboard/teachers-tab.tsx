'use client'

import * as React from 'react'
import { FileDown, Layers, Search } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
import { PaginationFooter, useDebouncedValue } from './pagination-footer'
import { formatHours, formatNumber } from './palette'
import { useDashboardStore, buildFilterQuery } from '@/lib/dashboard-store'
import { useTeachers, useTopLevelUnits, buildTeachersExportUrl, type HoursMode } from '@/lib/api-hooks'
import { downloadFile } from '@/lib/download'
import type { TeacherSortKey } from '@/lib/analytics'

export function TeachersTab() {
  const filters = useDashboardStore((s) => s.filters)
  const setSelectedTeacher = useDashboardStore((s) => s.setSelectedTeacher)
  const [sort, setSort] = React.useState<TeacherSortKey>('effectiveHours')
  const [page, setPage] = React.useState(1)
  const [pageSize, setPageSize] = React.useState(25)
  const [searchInput, setSearchInput] = React.useState('')
  const search = useDebouncedValue(searchInput, 300)
  const [topLevelUnitId, setTopLevelUnitId] = React.useState<string>('all')
  // Astronomical by default; academic converts hours ×4/3 (90 astr. min = 120 acad. min).
  const [hoursMode, setHoursMode] = React.useState<HoursMode>('astronomical')
  const { data: unitsMeta } = useTopLevelUnits()

  // Reset to first page whenever any filter changes.
  React.useEffect(() => setPage(1), [filters, sort, search, pageSize, topLevelUnitId])

  const baseQuery = buildFilterQuery(filters)
  const query =
    topLevelUnitId !== 'all' ? `${baseQuery}&topLevelUnitId=${topLevelUnitId}` : baseQuery
  const { data, isLoading, error, isFetching } = useTeachers(
    query,
    { page, pageSize, sort, search },
    hoursMode,
  )

  const items = (data?.items ?? []) as Array<{
    id: number
    name: string
    longName: string
    eventsCount: number
    effectiveHours: number
    scheduledHours: number
    simultaneousEvents: number
    simultaneousGroups: number
    simultaneousTimeSavedHours: number
    inferredEndEvents: number
    canceledEvents: number
  }>
  const total = data?.total ?? 0
  const totalPages = data?.totalPages ?? 1

  // Compute max values only across the current page (for mini-bar scaling).
  // For better visual context we keep a sensible default so single-row pages
  // still show a meaningful bar.
  const maxEffective = Math.max(1, ...items.map((t) => t.effectiveHours))

  const handlePageSizeChange = (n: number) => {
    setPageSize(n)
    setPage(1)
  }

  const [exporting, setExporting] = React.useState(false)
  const [exportError, setExportError] = React.useState<string | null>(null)

  // Download the rating as .xlsx for the current filters, sort, search and
  // hour mode — all rows, not just the visible page.
  const handleExport = async () => {
    setExporting(true)
    setExportError(null)
    try {
      await downloadFile(
        buildTeachersExportUrl(query, { sort, search }, hoursMode),
        'teachers-rating.xlsx',
      )
    } catch (e) {
      setExportError(e instanceof Error ? e.message : String(e))
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* Controls */}
      <Card>
        <CardContent className="py-3 flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">Подразделение</span>
            <Select
              value={topLevelUnitId}
              onValueChange={(v) => {
                setTopLevelUnitId(v)
                setPage(1)
              }}
            >
              <SelectTrigger className="w-[280px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все подразделения</SelectItem>
                {(unitsMeta?.topLevelUnits ?? []).map((u) => (
                  <SelectItem key={u.id} value={String(u.id)}>
                    {u.name} ({formatNumber(u.educatorCount)})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">Сортировка</span>
            <Select value={sort} onValueChange={(v) => setSort(v as TeacherSortKey)}>
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

          <div className="flex flex-col gap-1.5 flex-1 min-w-[200px]">
            <span className="text-xs text-muted-foreground">Поиск по имени</span>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Фамилия или имя… (серверный поиск)"
                className="pl-8"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center justify-between gap-2">
            <span>Рейтинг преподавателей</span>
            {total > 0 && (
              <span className="text-xs text-muted-foreground font-normal tabular-nums">
                Всего: {formatNumber(total)}
              </span>
            )}
          </CardTitle>
          <CardDescription>
            Эффективные часы — это сумма интервалов времени преподавателя без двойного учёта
            одновременных занятий. Запланированные — это прямая сумма длительностей всех событий.
            Загрузка выполняется страницами (по {pageSize} на страницу), поиск — серверный.
            Экспорт в Excel выгружает все найденные строки, а не только текущую страницу.
            {hoursMode === 'academic' &&
              ' Часы показаны академические: 90 астрономических минут = 120 академических (×4/3).'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* Hour-unit selector for this table: astronomical or academic (×4/3). */}
          <div className="flex flex-wrap items-center justify-between gap-2 pb-3">
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleExport}
                disabled={exporting || total === 0}
              >
                <FileDown />
                {exporting ? 'Экспорт…' : 'Экспорт в Excel'}
              </Button>
              {exportError && (
                <span className="text-xs text-destructive">Ошибка экспорта: {exportError}</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Часы</span>
              <Select value={hoursMode} onValueChange={(v) => setHoursMode(v as HoursMode)}>
                <SelectTrigger className="w-[220px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="astronomical">Астрономические (60 мин)</SelectItem>
                  <SelectItem value="academic">Академические (45 мин)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          {isLoading && !data ? (
            <Skeleton className="h-[420px] w-full" />
          ) : error ? (
            <div className="text-destructive text-sm">Ошибка: {String(error.message)}</div>
          ) : items.length === 0 ? (
            <div className="text-sm text-muted-foreground py-8 text-center">
              {search ? `Ничего не найдено по запросу «${search}»` : 'Нет данных'}
            </div>
          ) : (
            <div className="rounded-md border border-border/60 overflow-hidden">
              <div className="max-h-[640px] overflow-y-auto custom-scrollbar">
                <Table>
                  <TableHeader className="sticky top-0 bg-card z-10">
                    <TableRow>
                      <TableHead className="w-[60px]">#</TableHead>
                      <TableHead className="min-w-[200px]">Преподаватель</TableHead>
                      <TableHead className="text-right">Занятий</TableHead>
                      <TableHead className="text-right">
                        {hoursMode === 'academic' ? 'Эфф. ак. часов' : 'Эфф. часов'}
                      </TableHead>
                      <TableHead className="text-right">
                        {hoursMode === 'academic' ? 'Заплан. ак. часов' : 'Заплан. часов'}
                      </TableHead>
                      <TableHead className="w-[200px]">Нагрузка (эфф.)</TableHead>
                      <TableHead className="text-right">Одновр. группы</TableHead>
                      <TableHead className="text-right">Одновр. событий</TableHead>
                      <TableHead className="text-right">
                        {hoursMode === 'academic' ? 'Экономия, ак. ч' : 'Экономия, ч'}
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((t, i) => (
                      <TableRow
                        key={t.id}
                        onClick={() => setSelectedTeacher(t.id)}
                        className="cursor-pointer hover:bg-accent/40"
                      >
                        <TableCell className="text-muted-foreground tabular-nums">
                          {(page - 1) * pageSize + i + 1}
                        </TableCell>
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
              <PaginationFooter
                page={page}
                pageSize={pageSize}
                total={total}
                totalPages={totalPages}
                isLoading={isFetching}
                onPageChange={setPage}
                onPageSizeChange={handlePageSizeChange}
                label="преподавателей"
              />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
