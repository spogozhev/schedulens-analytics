'use client'

import { BookOpen, CalendarRange, Filter, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { MultiSelectFilter } from './multi-select-filter'
import { useDashboardStore } from '@/lib/dashboard-store'
import { useMeta } from '@/lib/api-hooks'

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('ru-RU', { timeZone: 'UTC' })
}

export function FiltersBar() {
  const filters = useDashboardStore((s) => s.filters)
  const setFilter = useDashboardStore((s) => s.setFilter)
  const resetFilters = useDashboardStore((s) => s.resetFilters)
  const setDateRanges = useDashboardStore((s) => s.setDateRanges)
  const { data: meta } = useMeta()
  const dateRanges = meta?.dateRanges ?? []
  const lessonForms = meta?.lessonForms ?? []

  const selectedPeriods = filters.dateRangeIds
  const selectedForms = filters.lessonFormIds

  return (
    <div className="flex flex-wrap items-end gap-3">
      <MultiSelectFilter
        label="Период (семестр)"
        icon={<CalendarRange className="h-4 w-4" />}
        options={dateRanges.map((r) => ({
          id: r.id,
          label: r.displayText,
          hint: `${formatDate(r.dateFrom)} — ${formatDate(r.dateTo)}`,
        }))}
        selectedIds={selectedPeriods}
        onChange={setDateRanges}
        allLabel="Все периоды"
        width="w-[260px]"
      />

      <MultiSelectFilter
        label="Форма занятия"
        icon={<BookOpen className="h-4 w-4" />}
        options={lessonForms.map((f) => ({ id: f.id, label: f.name }))}
        selectedIds={selectedForms}
        onChange={(ids) => setFilter('lessonFormIds', ids)}
        allLabel="Все формы"
        width="w-[200px]"
      />

      <div className="flex flex-col gap-1.5">
        <Label className="text-xs text-muted-foreground">Тип занятий</Label>
        <Select
          value={filters.kindCode}
          onValueChange={(v) => setFilter('kindCode', v as typeof filters.kindCode)}
        >
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="Все типы" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все типы</SelectItem>
            <SelectItem value="0">Индивидуальные мероприятия</SelectItem>
            <SelectItem value="1">Регулярные занятия</SelectItem>
            <SelectItem value="2">Сессия / консультации</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label className="text-xs text-muted-foreground">Детализация</Label>
        <Select
          value={filters.granularity}
          onValueChange={(v) => setFilter('granularity', v as 'day' | 'week')}
        >
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="Детализация" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="week">По неделям</SelectItem>
            <SelectItem value="day">По дням</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center gap-2 h-9">
        <Switch
          id="include-canceled"
          checked={filters.includeCanceled}
          onCheckedChange={(c) => setFilter('includeCanceled', c)}
        />
        <Label htmlFor="include-canceled" className="text-sm">
          Показать отменённые
        </Label>
      </div>

      <Button
        variant="ghost"
        size="sm"
        className="h-9"
        onClick={resetFilters}
        title="Сбросить фильтры"
      >
        <RotateCcw className="mr-2 h-4 w-4" />
        Сбросить
      </Button>

      <Separator orientation="vertical" className="hidden sm:block h-9" />
      <div className="hidden sm:flex items-center gap-2 text-xs text-muted-foreground">
        <Filter className="h-3.5 w-3.5" />
        {selectedPeriods.length === 0 && selectedForms.length === 0
          ? 'Без ограничения по периоду и форме'
          : `Фильтров выбрано: ${selectedPeriods.length + selectedForms.length}`}
      </div>
    </div>
  )
}
