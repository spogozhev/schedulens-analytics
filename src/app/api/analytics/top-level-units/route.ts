import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { adaptPlaceholders } from '@/lib/sql-dialect'

export const dynamic = 'force-dynamic'

/** Dialect-aware raw query: converts `?` placeholders for PostgreSQL. */
const rawQuery = (sql: string, ...params: (string | number)[]) =>
  db.$queryRawUnsafe(adaptPlaceholders(sql), ...params)

/**
 * First-level units (institutes / faculties) with the number of educators
 * that have timetable events — options for the unit filter on the teachers
 * tab. Units without teaching staff are hidden.
 */
export async function GET() {
  const rows = (await rawQuery(
    `SELECT u."id" AS id, u."name" AS name, COUNT(DISTINCT se."educatorId") AS "educatorCount"
       FROM "TopLevelUnit" u
       LEFT JOIN "Educator" e ON e."topLevelUnitId" = u."id"
       LEFT JOIN "ScheduleEvent" se ON se."educatorId" = e."id"
      GROUP BY u."id", u."name"
      HAVING COUNT(DISTINCT se."educatorId") > 0
      ORDER BY u."name"`,
  )) as Array<{ id: number | bigint; name: string; educatorCount: number | bigint }>

  return NextResponse.json({
    topLevelUnits: rows.map((r) => ({
      id: Number(r.id),
      name: r.name,
      educatorCount: Number(r.educatorCount),
    })),
  })
}
