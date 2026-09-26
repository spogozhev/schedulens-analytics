import { NextResponse } from 'next/server'
import {
  buildEventWhere,
  parseCommonFilters,
  computeTeacherWorkloadsAll,
  roundHours,
  type TeacherSortKey,
} from '@/lib/analytics'
import { buildTeachersRatingWorkbook } from '@/lib/excel-export'

export const dynamic = 'force-dynamic'

/**
 * Excel (.xlsx) export of the teachers rating — the same filtering, sorting
 * and hour conversion as GET /api/analytics/teachers, but unpaginated: the
 * file always contains every teacher matching the current filters.
 */
export async function GET(request: Request) {
  const url = new URL(request.url)
  const filters = parseCommonFilters(url)
  const where = buildEventWhere(filters)

  const sort = (url.searchParams.get('sort') as TeacherSortKey) || 'effectiveHours'
  const search = url.searchParams.get('search') || ''
  const unitParam = parseInt(url.searchParams.get('topLevelUnitId') || '', 10)
  const topLevelUnitId = Number.isInteger(unitParam) && unitParam > 0 ? unitParam : undefined
  const academic = url.searchParams.get('hours') === 'academic'

  const workloads = await computeTeacherWorkloadsAll(where, { sort, search, topLevelUnitId })

  // Hour units: academic = astronomical × 4/3, rounded once from raw minutes
  // (identical to the JSON route, so the file matches the on-screen table).
  const factor = academic ? 4 / 3 : 1
  const rows = workloads.map((t, i) => ({
    rank: i + 1,
    name: t.longName || t.displayName,
    eventsCount: t.eventsCount,
    effectiveHours: roundHours(t.effectiveMinutes * factor),
    scheduledHours: roundHours(t.scheduledMinutes * factor),
    simultaneousGroups: t.simultaneousGroups,
    simultaneousEvents: t.simultaneousEvents,
    timeSavedHours: roundHours((t.scheduledMinutes - t.effectiveMinutes) * factor),
    inferredEndEvents: t.inferredEndEvents,
    canceledEvents: t.canceledEvents,
  }))

  const workbook = buildTeachersRatingWorkbook(rows, academic)
  const buffer = await workbook.xlsx.writeBuffer()

  // Cyrillic filename via RFC 5987 with an ASCII fallback for old clients.
  const date = new Date().toISOString().slice(0, 10)
  const asciiName = `teachers-rating-${date}.xlsx`
  const utf8Name = encodeURIComponent(`рейтинг-преподавателей-${date}.xlsx`)
  return new NextResponse(buffer as ArrayBuffer, {
    headers: {
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${asciiName}"; filename*=UTF-8''${utf8Name}`,
      'Cache-Control': 'no-store',
    },
  })
}
