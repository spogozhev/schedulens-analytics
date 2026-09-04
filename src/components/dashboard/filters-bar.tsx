'use client'

import * as React from 'react'
import { CalendarRange, Filter, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Separator } from '@/components/ui/separator'
import { useDashboardStore } from '@/lib/dashboard-store'

export function FiltersBar() {
  const { filters, setFilter, resetFilters, setRange } = useDashboardStore()
  const [open, setOpen] = React.useState(false)

  const setPreset = (preset: 'all' | 'term' | 'month' | 'week') => {
    const now = new Date()
    if (preset === 'all') {
      setRange(null, null)
    } else if (preset === 'term') {
      // Spring term: Feb 1 - Aug 1
      setRange('2026-02-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z')
    } else if (preset === 'month') {
      const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
      const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59))
      setRange(from.toISOString(), to.toISOString())
    } else if (preset === 'week') {
      const now2 = new Date()
      const day = (now2.getUTCDay() + 6) % 7 // 0=Mon
      const from = new Date(Date.UTC(now2.getUTCFullYear(), now2.getUTCMonth(), now2.getUTCDate() - day))
      const to = new Date(from.getTime() + 7 * 86_400_000 - 1)
      setRange(from.toISOString(), to.toISOString())
    }
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs text-muted-foreground">Период с</Label>
        <Input
          type="date"
          value={filters.from ? filters.from.slice(0, 10) : ''}
          onChange={(e) => {
            const v = e.target.value
            setRange(v ? new Date(v + 'T00:00:00.000Z').toISOString() : null, filters.to)
          }}
          className="w-[150px]"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs text-muted-foreground">Период по</Label>
        <Input
          type="date"
          value={filters.to ? filters.to.slice(0, 10) : ''}
          onChange={(e) => {
            const v = e.target.value
            setRange(filters.from, v ? new Date(v + 'T23:59:59.999Z').toISOString() : null)
          }}
          className="w-[150px]"
        />
      </div>

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

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="h-9">
            <CalendarRange className="mr-2 h-4 w-4" />
            Быстрый период
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-56" align="start">
          <div className="grid gap-2">
            <Button variant="ghost" size="sm" onClick={() => { setPreset('all'); setOpen(false) }}>
              Всё время
            </Button>
            <Button variant="ghost" size="sm" onClick={() => { setPreset('term'); setOpen(false) }}>
              Семестр (фев–авг)
            </Button>
            <Button variant="ghost" size="sm" onClick={() => { setPreset('month'); setOpen(false) }}>
              Текущий месяц
            </Button>
            <Button variant="ghost" size="sm" onClick={() => { setPreset('week'); setOpen(false) }}>
              Текущая неделя
            </Button>
          </div>
        </PopoverContent>
      </Popover>

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
        {filters.from || filters.to
          ? `Фильтр: ${filters.from ? new Date(filters.from).toLocaleDateString('ru-RU') : '...'} — ${filters.to ? new Date(filters.to).toLocaleDateString('ru-RU') : '...'}`
          : 'Без ограничения по датам'}
      </div>
    </div>
  )
}
