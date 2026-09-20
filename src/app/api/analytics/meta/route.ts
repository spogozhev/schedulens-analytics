import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getDateBounds, KIND_LABELS } from '@/lib/analytics'

export const dynamic = 'force-dynamic'

/**
 * Global dashboard metadata — independent of the from/to/kindCode filters:
 * the dataset date bounds (min start / max end across all events), the
 * fixed kind filter options and the available schedule periods (DateRange)
 * for the period filter.
 */
export async function GET() {
  const [bounds, dateRanges, lessonForms] = await Promise.all([
    getDateBounds(),
    db.dateRange.findMany({
      select: { id: true, displayText: true, dateFrom: true, dateTo: true },
      orderBy: { dateFrom: 'asc' },
    }),
    db.lessonForm.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
  ])

  return NextResponse.json({
    dateBounds: bounds
      ? { from: bounds.from.toISOString(), to: bounds.to.toISOString() }
      : null,
    filterOptions: {
      kinds: Object.entries(KIND_LABELS).map(([code, label]) => ({ kindCode: Number(code), label })),
    },
    dateRanges: dateRanges.map((r) => ({
      id: r.id,
      displayText: r.displayText,
      dateFrom: r.dateFrom.toISOString(),
      dateTo: r.dateTo.toISOString(),
    })),
    lessonForms: lessonForms,
  })
}
