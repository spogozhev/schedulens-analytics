'use client'

import * as React from 'react'
import { Check, ChevronDown, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

export interface MultiOption {
  id: number
  label: string
  hint?: string
}

/**
 * Multi-select filter (checkbox list in a popover). Empty selection = the
 * filter is inactive ("all"). With `searchable` the popover shows a text
 * input that filters options client-side — for long lists (departments).
 * Shared by the dashboard filter bar (periods, lesson forms) and the
 * teachers/rooms tabs (departments, addresses).
 */
export function MultiSelectFilter({
  label,
  icon,
  options,
  selectedIds,
  onChange,
  allLabel,
  width = 'w-[220px]',
  searchable = false,
}: {
  label: string
  icon: React.ReactNode
  options: MultiOption[]
  selectedIds: number[]
  onChange: (ids: number[]) => void
  allLabel: string
  width?: string
  searchable?: boolean
}) {
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState('')

  const buttonLabel =
    selectedIds.length === 0
      ? allLabel
      : selectedIds.length === 1
        ? (options.find((o) => o.id === selectedIds[0])?.label ?? `#${selectedIds[0]}`)
        : `Выбрано: ${selectedIds.length}`

  const visible = query
    ? options.filter((o) => o.label.toLowerCase().includes(query.toLowerCase()))
    : options
  const selectedSet = new Set(selectedIds)

  const toggle = (id: number) =>
    onChange(selectedIds.includes(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id])

  const handleOpenChange = (o: boolean) => {
    setOpen(o)
    if (o) setQuery('') // fresh search on every open
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className={cn(width, 'justify-between font-normal')}
          >
            <span className="flex min-w-0 items-center gap-2">
              <span className="shrink-0 text-muted-foreground">{icon}</span>
              <span className="truncate">{buttonLabel}</span>
            </span>
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[340px] p-2" align="start">
          {searchable && (
            <div className="relative mb-2">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Поиск…"
                className="h-9 pl-8"
              />
            </div>
          )}
          {options.length === 0 ? (
            <div className="px-2 py-4 text-sm text-muted-foreground">Ничего не найдено</div>
          ) : visible.length === 0 ? (
            <div className="px-2 py-4 text-sm text-muted-foreground">Не найдено: {query}</div>
          ) : (
            <div className={cn('overflow-y-auto custom-scrollbar', searchable ? 'max-h-[320px]' : 'max-h-[300px]')}>
              {visible.map((o) => {
                const checked = selectedSet.has(o.id)
                return (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => toggle(o.id)}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-accent/60',
                      checked && 'bg-accent/40',
                    )}
                  >
                    <span
                      className={cn(
                        'flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border',
                        checked ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/40',
                      )}
                    >
                      {checked && <Check className="h-3 w-3" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{o.label}</span>
                      {o.hint && <span className="block text-xs text-muted-foreground">{o.hint}</span>}
                    </span>
                  </button>
                )
              })}
            </div>
          )}
          <div className="mt-2 flex items-center justify-between border-t pt-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onChange([])}
              disabled={selectedIds.length === 0}
            >
              Снять выбор
            </Button>
            {selectedIds.length > 0 && (
              <Badge variant="secondary" className="mr-1">
                {selectedIds.length} из {options.length}
              </Badge>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}
