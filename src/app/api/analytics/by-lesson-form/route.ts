import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { buildEventWhere, parseCommonFilters } from '@/lib/analytics'

export const dynamic = 'force-dynamic'

/**
 * Event counts per lesson form — data for the "По формам занятий" chart.
 * Events whose Subject carries no recognized form are bucketed as
 * "Без формы". Sorted by count descending.
 */
export async function GET(request: Request) {
  const url = new URL(request.url)
  const where = buildEventWhere(parseCommonFilters(url))

  const [agg, forms] = await Promise.all([
    db.scheduleEvent.groupBy({ by: ['lessonFormId'], where, _count: { _all: true } }),
    db.lessonForm.findMany({ select: { id: true, name: true } }),
  ])
  const formNames = new Map(forms.map((f) => [f.id, f.name]))

  const byLessonForm = agg
    .map((g) => ({
      id: g.lessonFormId,
      name:
        g.lessonFormId === null
          ? 'Без формы'
          : (formNames.get(g.lessonFormId) ?? `Форма #${g.lessonFormId}`),
      count: g._count._all,
    }))
    .sort((a, b) => b.count - a.count)

  return NextResponse.json({ byLessonForm })
}
