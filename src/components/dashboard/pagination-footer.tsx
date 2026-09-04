'use client'

import * as React from 'react'
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { formatNumber } from './palette'

interface PaginationFooterProps {
  page: number
  pageSize: number
  total: number
  totalPages: number
  isLoading?: boolean
  onPageChange: (page: number) => void
  onPageSizeChange: (pageSize: number) => void
  pageSizeOptions?: number[]
  label?: string
}

export function PaginationFooter({
  page,
  pageSize,
  total,
  totalPages,
  isLoading,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [10, 25, 50, 100],
  label = 'записей',
}: PaginationFooterProps) {
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1
  const end = Math.min(total, page * pageSize)

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-3 py-2 border-t bg-muted/30">
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span>
          {total > 0 ? (
            <>
              <span className="font-medium tabular-nums">{formatNumber(start)}–{formatNumber(end)}</span>
              {' '}
              из{' '}
              <span className="font-medium tabular-nums">{formatNumber(total)}</span>{' '}{label}
            </>
          ) : (
            <>Нет данных</>
          )}
        </span>
        <span className="hidden sm:inline">·</span>
        <div className="flex items-center gap-1.5">
          <span className="hidden sm:inline">На странице:</span>
          <Select value={String(pageSize)} onValueChange={(v) => onPageSizeChange(parseInt(v, 10))} disabled={isLoading}>
            <SelectTrigger className="h-7 w-[78px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {pageSizeOptions.map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {n}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="icon"
          className="h-7 w-7"
          onClick={() => onPageChange(1)}
          disabled={page <= 1 || isLoading}
          aria-label="Первая страница"
          title="Первая страница"
        >
          <ChevronsLeft className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          className="h-7 w-7"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1 || isLoading}
          aria-label="Предыдущая страница"
          title="Предыдущая страница"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </Button>
        <div className="flex items-center gap-1.5 text-xs tabular-nums px-2">
          <span className="text-muted-foreground">Стр.</span>
          <span className="font-medium">{page}</span>
          <span className="text-muted-foreground">/ {Math.max(1, totalPages)}</span>
        </div>
        <Button
          variant="outline"
          size="icon"
          className="h-7 w-7"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages || isLoading}
          aria-label="Следующая страница"
          title="Следующая страница"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          className="h-7 w-7"
          onClick={() => onPageChange(totalPages)}
          disabled={page >= totalPages || isLoading}
          aria-label="Последняя страница"
          title="Последняя страница"
        >
          <ChevronsRight className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  )
}

/**
 * Hook to debounce a value (e.g. for search input). Returns the debounced
 * value after the specified delay (default 300ms).
 */
export function useDebouncedValue<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = React.useState(value)
  React.useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(id)
  }, [value, delay])
  return debounced
}
