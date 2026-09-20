import { NextResponse } from 'next/server'
import { buildEventWhere, computeByMonthByKind, parseCommonFilters } from '@/lib/analytics'

export const dynamic = 'force-dynamic'

/**
 * Event counts per (month, kindCode) as flat rows `{ month, monthLabel,
 * kindCode, count }` — raw data for the stacked-by-month chart. The client
 * pivots the rows into one bar per month and derives the series (one per
 * kind) from its own static kind labels.
 */
export async function GET(request: Request) {
  const url = new URL(request.url)
  const where = buildEventWhere(parseCommonFilters(url))

  const byMonthByKind = await computeByMonthByKind(where)

  return NextResponse.json({ byMonthByKind })
}
