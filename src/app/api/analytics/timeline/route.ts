import { NextResponse } from 'next/server'
import { buildEventWhere, computeTimeline, parseCommonFilters } from '@/lib/analytics'

export const dynamic = 'force-dynamic'

/**
 * Timeline buckets (events + scheduled/effective minutes per day or week).
 * The day×hour heatmap lives in its own /api/analytics/heatmap endpoint.
 */
export async function GET(request: Request) {
  const url = new URL(request.url)
  const where = buildEventWhere(parseCommonFilters(url))
  const granularity = (url.searchParams.get('granularity') || 'week') as 'day' | 'week'

  const timeline = await computeTimeline(where, granularity)

  return NextResponse.json({ granularity, timeline })
}
