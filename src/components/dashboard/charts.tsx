'use client'

import * as React from 'react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'
import { CHART_COLORS, SEQUENCE } from './palette'

// ---------- Line Chart (timeline) ----------

interface LineChartCardProps {
  data: Array<Record<string, unknown>>
  xKey: string
  series: Array<{ key: string; label: string; color?: string }>
  yFormatter?: (v: number) => string
  height?: number
}

export function LineChartCard({ data, xKey, series, yFormatter, height = 260 }: LineChartCardProps) {
  const config: ChartConfig = {}
  for (const s of series) {
    config[s.key] = { label: s.label, color: s.color ?? CHART_COLORS.primary }
  }
  return (
    <ChartContainer config={config} style={{ height }} className="w-full">
      <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-muted/40" />
        <XAxis dataKey={xKey} tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} fontSize={11} />
        <YAxis
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          fontSize={11}
          tickFormatter={(v) => (yFormatter ? yFormatter(v as number) : String(v))}
          width={48}
        />
        <ChartTooltip content={<ChartTooltipContent />} />
        {series.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}
        {series.map((s) => (
          <Line
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.label}
            stroke={s.color ?? CHART_COLORS.primary}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
          />
        ))}
      </LineChart>
    </ChartContainer>
  )
}

// ---------- Area Chart (timeline with single series) ----------

interface AreaChartCardProps {
  data: Array<Record<string, unknown>>
  xKey: string
  series: Array<{ key: string; label: string; color?: string }>
  height?: number
}

export function AreaChartCard({ data, xKey, series, height = 260 }: AreaChartCardProps) {
  const config: ChartConfig = {}
  for (const s of series) {
    config[s.key] = { label: s.label, color: s.color ?? CHART_COLORS.primary }
  }
  return (
    <ChartContainer config={config} style={{ height }} className="w-full">
      <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <defs>
          {series.map((s, i) => (
            <linearGradient
              key={s.key}
              id={`grad-${i}-${s.key}`}
              x1="0"
              y1="0"
              x2="0"
              y2="1"
            >
              <stop offset="5%" stopColor={s.color ?? CHART_COLORS.primary} stopOpacity={0.35} />
              <stop offset="95%" stopColor={s.color ?? CHART_COLORS.primary} stopOpacity={0} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-muted/40" />
        <XAxis dataKey={xKey} tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} fontSize={11} />
        <YAxis tickLine={false} axisLine={false} tickMargin={8} fontSize={11} width={48} />
        <ChartTooltip content={<ChartTooltipContent />} />
        {series.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}
        {series.map((s, i) => (
          <Area
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.label}
            stroke={s.color ?? CHART_COLORS.primary}
            fill={`url(#grad-${i}-${s.key})`}
            strokeWidth={2}
          />
        ))}
      </AreaChart>
    </ChartContainer>
  )
}

// ---------- Bar Chart ----------

interface BarChartCardProps {
  data: Array<Record<string, unknown>>
  xKey: string
  series: Array<{ key: string; label: string; color?: string }>
  yFormatter?: (v: number) => string
  height?: number
  horizontal?: boolean
  yWidth?: number
  /** When true, bars are stacked on top of each other (one bar per series). */
  stacked?: boolean
  /** When true (default), X-axis labels are rotated -20° for long names.
   *  Set to false for short labels (e.g. month abbreviations) so they render
   *  horizontally and are easier to read. */
  rotateX?: boolean
}

export function BarChartCard({
  data,
  xKey,
  series,
  yFormatter,
  height = 280,
  horizontal = false,
  yWidth = 48,
  stacked = false,
  rotateX = true,
}: BarChartCardProps) {
  const config: ChartConfig = {}
  for (const s of series) {
    config[s.key] = { label: s.label, color: s.color ?? CHART_COLORS.primary }
  }
  // Build the axis elements as variables — NOT wrapped in React fragments.
  // Recharts iterates its children with `React.Children` and does not
  // always descend into fragments, which caused axes to silently not
  // render (the #1 reason this chart showed no labels before this fix).
  const xAxisEl = horizontal ? (
    <XAxis
      type="number"
      tickLine={false}
      axisLine={false}
      fontSize={11}
      tickFormatter={(v) => (yFormatter ? yFormatter(v as number) : String(v))}
    />
  ) : (
    <XAxis
      dataKey={xKey}
      tickLine
      axisLine
      tickMargin={8}
      fontSize={11}
      interval={0}
      angle={rotateX ? -20 : 0}
      textAnchor={rotateX ? 'end' : 'middle'}
      height={rotateX ? 50 : 30}
    />
  )
  const yAxisEl = horizontal ? (
    <YAxis
      type="category"
      dataKey={xKey}
      tickLine={false}
      axisLine={false}
      width={yWidth}
      fontSize={10}
      interval={0}
    />
  ) : (
    <YAxis
      tickLine={false}
      axisLine={false}
      tickMargin={8}
      fontSize={11}
      tickFormatter={(v) => (yFormatter ? yFormatter(v as number) : String(v))}
      width={yWidth}
    />
  )
  return (
    <ChartContainer config={config} style={{ height }} className="w-full">
      <BarChart
        data={data}
        layout={horizontal ? 'vertical' : 'horizontal'}
        margin={{ top: 8, right: 16, bottom: 0, left: 0 }}
      >
        <CartesianGrid
          strokeDasharray="3 3"
          vertical={horizontal}
          horizontal={!horizontal}
          className="stroke-muted/40"
        />
        {xAxisEl}
        {yAxisEl}
        <ChartTooltip content={<ChartTooltipContent />} />
        {series.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}
        {series.map((s, i) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            name={s.label}
            fill={s.color ?? SEQUENCE[i % SEQUENCE.length]}
            radius={horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]}
            maxBarSize={horizontal ? 22 : 60}
            stackId={stacked ? 'stack' : undefined}
          />
        ))}
      </BarChart>
    </ChartContainer>
  )
}

// ---------- Pie / Donut Chart ----------

interface PieChartCardProps {
  data: Array<{ name: string; value: number; color?: string }>
  height?: number
  donut?: boolean
}

export function PieChartCard({ data, height = 260, donut = true }: PieChartCardProps) {
  const config: ChartConfig = {}
  for (let i = 0; i < data.length; i++) {
    config[data[i].name] = { label: data[i].name, color: data[i].color ?? SEQUENCE[i % SEQUENCE.length] }
  }
  return (
    <ChartContainer config={config} style={{ height }} className="w-full">
      <PieChart>
        <ChartTooltip content={<ChartTooltipContent nameKey="name" />} />
        <Pie
          data={data}
          dataKey="value"
          nameKey="name"
          innerRadius={donut ? 50 : 0}
          outerRadius={90}
          paddingAngle={1}
        >
          {data.map((d, i) => (
            <Cell key={d.name} fill={d.color ?? SEQUENCE[i % SEQUENCE.length]} />
          ))}
        </Pie>
        <Legend wrapperStyle={{ fontSize: 11 }} />
      </PieChart>
    </ChartContainer>
  )
}

// ---------- Heatmap (custom grid) ----------

interface HeatmapProps {
  data: Array<Array<{ day: number; dayName: string; hour: number; events: number; simultaneous: number }>>
  height?: number
}

export function Heatmap({ data, height = 220 }: HeatmapProps) {
  // Find max events across cells for color scale.
  let maxEvents = 0
  for (const row of data) for (const cell of row) maxEvents = Math.max(maxEvents, cell.events)
  if (maxEvents === 0) maxEvents = 1

  const colorFor = (v: number): string => {
    if (v === 0) return 'transparent'
    // intensity 0..1 mapped to orange ramp
    const intensity = Math.min(1, v / maxEvents)
    // Use orange ramp: from rgba(234,88,12,alpha) to fully saturated
    const alpha = 0.15 + 0.7 * intensity
    return `rgba(234, 88, 12, ${alpha.toFixed(2)})`
  }

  return (
    <div className="w-full overflow-x-auto" style={{ height }}>
      <div className="min-w-[640px]">
        {/* Hour labels row */}
        <div className="grid grid-cols-[60px_repeat(24,1fr)] gap-px">
          <div />
          {Array.from({ length: 24 }, (_, h) => (
            <div key={h} className="text-[10px] text-muted-foreground text-center">
              {h}
            </div>
          ))}
        </div>
        {/* Day rows */}
        {data.map((row) => (
          <div key={row[0].day} className="grid grid-cols-[60px_repeat(24,1fr)] gap-px">
            <div className="text-[11px] text-muted-foreground flex items-center pr-2 justify-end">
              {row[0].dayName.slice(0, 3)}
            </div>
            {row.map((cell) => (
              <div
                key={cell.hour}
                className="aspect-square rounded-[2px] border border-border/40 transition-colors hover:border-primary cursor-default flex items-center justify-center"
                style={{ background: colorFor(cell.events) }}
                title={`${row[0].dayName}, ${cell.hour}:00 — ${cell.events} занятий (${cell.simultaneous} одновр.)`}
              >
                {cell.events > 0 && (
                  <span className="text-[10px] font-medium text-foreground/70 leading-none">
                    {cell.events}
                  </span>
                )}
              </div>
            ))}
          </div>
        ))}
        {/* Legend */}
        <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
          <span>Меньше</span>
          {[0.1, 0.3, 0.5, 0.7, 1].map((i) => (
            <div
              key={i}
              className="h-3 w-6 rounded-sm border border-border/40"
              style={{ background: `rgba(234, 88, 12, ${(0.15 + 0.7 * i).toFixed(2)})` }}
            />
          ))}
          <span>Больше</span>
        </div>
      </div>
    </div>
  )
}

// ---------- Mini bar (for inline use) ----------

export function MiniBar({ value, max, color = CHART_COLORS.primary }: { value: number; max: number; color?: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0
  return (
    <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
    </div>
  )
}
