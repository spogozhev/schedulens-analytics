import { NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { buildEventWhere, KIND_LABELS, type CommonFilters } from '@/lib/analytics'
import { slowCached } from '@/lib/slow-cache'
import { buildTeacherEventsWorkbook, type TeacherEventRow } from '@/lib/excel-export'

export const dynamic = 'force-dynamic'

/**
 * Excel (.xlsx) export of a teacher's full event list — the same filters as
 * the teacher card (GET /api/analytics/teacher/[id]), but with every event
 * instead of the recent-100 sample shown in the card.
 */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: idStr } = await ctx.params
  const id = parseInt(idStr, 10)
  if (Number.isNaN(id)) return NextResponse.json({ error: 'Bad id' }, { status: 400 })

  const url = new URL(request.url)
  const filters: CommonFilters = {
    dateRangeIds: url.searchParams.get('dateRangeIds'),
    kindCode: url.searchParams.get('kindCode'),
    includeCanceled: url.searchParams.get('includeCanceled') ?? 'false',
  }
  const where = buildEventWhere(filters)

  const rows = await slowCached('teacherEventsExport', { id, filters }, () =>
    loadTeacherEventRows(id, where),
  )
  if (rows === null) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const workbook = buildTeacherEventsWorkbook(rows.events, rows.teacherName)
  const buffer = await workbook.xlsx.writeBuffer()

  // Cyrillic filename via RFC 5987 with an ASCII fallback for old clients.
  const date = new Date().toISOString().slice(0, 10)
  const asciiName = `teacher-events-${id}-${date}.xlsx`
  const utf8Name = encodeURIComponent(`занятия-${rows.teacherName}-${date}.xlsx`)
  return new NextResponse(buffer as ArrayBuffer, {
    headers: {
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${asciiName}"; filename*=UTF-8''${utf8Name}`,
      'Cache-Control': 'no-store',
    },
  })
}

/** All events of one teacher shaped for the Excel export, or null if unknown. */
async function loadTeacherEventRows(
  id: number,
  where: Prisma.ScheduleEventWhereInput,
): Promise<{ teacherName: string; events: TeacherEventRow[] } | null> {
  const teacher = await db.educator.findUnique({
    where: { id },
    select: {
      displayName: true,
      events: {
        where,
        select: {
          startDateTime: true,
          rawStart: true,
          rawEnd: true,
          durationMinutes: true,
          kindCode: true,
          lectureHash: true,
          subject: { select: { name: true } },
          lessonForm: { select: { name: true } },
          // The primary location is denormalized into `location`; the
          // `locations` join table holds only ADDITIONAL locations.
          location: { select: { displayName: true } },
          locations: { include: { location: { select: { displayName: true } } } },
          groups: { include: { group: { select: { name: true } } } },
        },
        orderBy: { startDateTime: 'asc' },
      },
    },
  })
  if (!teacher) return null

  // Co-teachers per event, derived from lectureHash exactly like the card:
  // every event with the same hash and a different real educator (> 0).
  const hashes = [...new Set(teacher.events.map((e) => e.lectureHash))]
  const coTeacherRows = hashes.length > 0
    ? await db.scheduleEvent.findMany({
        where: {
          lectureHash: { in: hashes },
          educatorId: { gt: 0, not: id },
        },
        select: {
          lectureHash: true,
          educator: { select: { displayName: true } },
        },
      })
    : []
  const coTeachersByHash = new Map<string, string[]>()
  for (const row of coTeacherRows) {
    const arr = coTeachersByHash.get(row.lectureHash) ?? []
    if (!arr.includes(row.educator.displayName)) arr.push(row.educator.displayName)
    coTeachersByHash.set(row.lectureHash, arr)
  }

  // Event timestamps are epoch milliseconds of the LOCAL schedule time (the
  // UI renders them in UTC), so the Date cells carry the intended date.
  const events = teacher.events.map((e) => ({
    date: e.startDateTime,
    time: e.rawEnd ? `${e.rawStart}–${e.rawEnd}` : `${e.rawStart}–${e.rawStart}+90м`,
    durationMinutes: e.durationMinutes,
    subject: e.subject.name,
    kind: KIND_LABELS[e.kindCode] ?? `Тип ${e.kindCode}`,
    lessonForm: e.lessonForm?.name ?? '',
    groups: e.groups.map((g) => g.group.name).join(', '),
    address: [
      ...(e.location ? [e.location.displayName] : []),
      ...e.locations.map((l) => l.location.displayName),
    ].join(', '),
    coEducators: (coTeachersByHash.get(e.lectureHash) ?? []).join(', '),
  }))
  return { teacherName: teacher.displayName, events }
}
