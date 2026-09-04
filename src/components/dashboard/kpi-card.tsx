'use client'

import * as React from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { LucideIcon } from 'lucide-react'

interface KpiCardProps {
  title: string
  value: React.ReactNode
  hint?: React.ReactNode
  icon?: LucideIcon
  accent?: 'primary' | 'secondary' | 'accent' | 'warning' | 'muted' | 'info'
  children?: React.ReactNode
}

const ACCENT_COLORS: Record<NonNullable<KpiCardProps['accent']>, string> = {
  primary: 'text-orange-600 dark:text-orange-500',
  secondary: 'text-emerald-600 dark:text-emerald-500',
  accent: 'text-amber-600 dark:text-amber-500',
  warning: 'text-red-600 dark:text-red-500',
  muted: 'text-muted-foreground',
  info: 'text-cyan-600 dark:text-cyan-500',
}

const ACCENT_BG: Record<NonNullable<KpiCardProps['accent']>, string> = {
  primary: 'bg-orange-50 dark:bg-orange-950/30',
  secondary: 'bg-emerald-50 dark:bg-emerald-950/30',
  accent: 'bg-amber-50 dark:bg-amber-950/30',
  warning: 'bg-red-50 dark:bg-red-950/30',
  muted: 'bg-muted',
  info: 'bg-cyan-50 dark:bg-cyan-950/30',
}

export function KpiCard({ title, value, hint, icon: Icon, accent = 'primary', children }: KpiCardProps) {
  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
          {Icon && (
            <div className={cn('rounded-md p-1.5', ACCENT_BG[accent], ACCENT_COLORS[accent])}>
              <Icon className="h-4 w-4" />
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className={cn('text-2xl font-bold tabular-nums', ACCENT_COLORS[accent])}>{value}</div>
        {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
        {children && <div className="mt-2">{children}</div>}
      </CardContent>
    </Card>
  )
}
