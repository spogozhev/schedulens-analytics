import { NextResponse } from 'next/server'
import { buildEventWhere, computeHeatmap, parseCommonFilters } from '@/lib/analytics'

export const dynamic = 'force-dynamic'

/** 7×24 grid (day of week × hour) of event counts — the heatmap card data. */
export async function GET(request: Request) {
  const url = new URL(request.url)
  const where = buildEventWhere(parseCommonFilters(url))

  const heatmap = await computeHeatmap(where)

  return NextResponse.json({ heatmap })
}
