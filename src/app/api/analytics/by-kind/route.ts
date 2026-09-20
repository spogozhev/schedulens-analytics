import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  buildEventWhere,
  parseCommonFilters,
  KIND_LABELS,
} from '@/lib/analytics'
import { withTiming } from '@/lib/timing'

export const dynamic = 'force-dynamic'

/** Event counts grouped by kindCode — data for the "По типу занятий" pie. */
export async function GET(request: Request) {
  const url = new URL(request.url)
  const where = buildEventWhere(parseCommonFilters(url))

  const kindAgg = await withTiming(
    'by-kind:groupBy',
    () => db.scheduleEvent.groupBy({ by: ['kindCode'], where, _count: { _all: true } }),
  )

  const byKind = kindAgg
    .map((k) => ({
      kindCode: k.kindCode,
      label: KIND_LABELS[k.kindCode] ?? `Тип ${k.kindCode}`,
      count: k._count._all,
    }))
    .sort((a, b) => a.kindCode - b.kindCode)

  return NextResponse.json({ byKind })
}
