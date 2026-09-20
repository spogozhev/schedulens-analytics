/**
 * Saves "golden" JSON responses of the analytics endpoints for the current
 * implementation. Used to verify that the raw-SQL rewrite produces identical
 * results: run this BEFORE the rewrite, then scripts/golden-check.ts after.
 *
 * Usage:
 *   DATABASE_URL="file:<db>" GOLDEN_DIR=/tmp/tta-golden/<tag> DB_LOG_SLOW_MS=-1 \
 *     bun scripts/golden-save.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { GET as kpiGET } from '../src/app/api/analytics/kpi/route'
import { GET as byKindGET } from '../src/app/api/analytics/by-kind/route'
import { GET as byLessonFormGET } from '../src/app/api/analytics/by-lesson-form/route'
import { GET as heatmapGET } from '../src/app/api/analytics/heatmap/route'
import { GET as timelineGET } from '../src/app/api/analytics/timeline/route'
import { GET as topTeachersGET } from '../src/app/api/analytics/top-teachers/route'
import { GET as topRoomsGET } from '../src/app/api/analytics/top-rooms/route'
import { GET as teachersGET } from '../src/app/api/analytics/teachers/route'
import { GET as roomsGET } from '../src/app/api/analytics/rooms/route'
import { GET as metaGET } from '../src/app/api/analytics/meta/route'

import { db } from '../src/lib/db'

// Resolve filter ids by name so golden cases are portable across DBMS
// (autoincrement ids may differ between SQLite and PostgreSQL).
const ADDRESS_ID =
  (await db.address.findFirst({ where: { displayName: 'Университетский проспект, д. 35' }, select: { id: true } }))?.id ?? 0
const UNIT_ID =
  (await db.topLevelUnit.findFirst({ where: { name: { startsWith: 'Биологический' } }, select: { id: true } }))?.id ?? 0

const BASE = 'http://golden.local/api/analytics'
const OUT = process.env.GOLDEN_DIR ?? '/tmp/tta-golden/run'
mkdirSync(OUT, { recursive: true })

// `q` = unfiltered query suffix shared by all cases.
const q = 'includeCanceled=false'
const RANGE = 'dateRangeIds=1'

const CASES: Array<{ tag: string; handler: (r: Request) => Promise<Response>; url: string }> = [
  { tag: 'kpi-all', handler: kpiGET, url: `${BASE}/kpi?${q}` },
  { tag: 'kpi-range', handler: kpiGET, url: `${BASE}/kpi?${RANGE}&${q}` },
  { tag: 'kpi-kind2', handler: kpiGET, url: `${BASE}/kpi?kindCode=2&${q}` },
  { tag: 'kpi-canceled', handler: kpiGET, url: `${BASE}/kpi?includeCanceled=true` },
  { tag: 'kpi-form', handler: kpiGET, url: `${BASE}/kpi?lessonFormIds=1&${q}` },
  { tag: 'by-kind-all', handler: byKindGET, url: `${BASE}/by-kind?${q}` },
  { tag: 'by-lesson-form-all', handler: byLessonFormGET, url: `${BASE}/by-lesson-form?${q}` },
  { tag: 'heatmap-all', handler: heatmapGET, url: `${BASE}/heatmap?${q}` },
  { tag: 'heatmap-range', handler: heatmapGET, url: `${BASE}/heatmap?${RANGE}&${q}` },
  { tag: 'timeline-week', handler: timelineGET, url: `${BASE}/timeline?${q}&granularity=week` },
  { tag: 'timeline-day', handler: timelineGET, url: `${BASE}/timeline?${q}&granularity=day` },
  { tag: 'timeline-range', handler: timelineGET, url: `${BASE}/timeline?${RANGE}&${q}&granularity=week` },
  { tag: 'top-teachers-10', handler: topTeachersGET, url: `${BASE}/top-teachers?${q}&limit=10` },
  { tag: 'top-teachers-3', handler: topTeachersGET, url: `${BASE}/top-teachers?${q}&limit=3` },
  { tag: 'top-teachers-range', handler: topTeachersGET, url: `${BASE}/top-teachers?${RANGE}&${q}` },
  { tag: 'top-rooms-10', handler: topRoomsGET, url: `${BASE}/top-rooms?${q}&limit=10` },
  { tag: 'top-rooms-range', handler: topRoomsGET, url: `${BASE}/top-rooms?${RANGE}&${q}` },
  { tag: 'teachers-p1', handler: teachersGET, url: `${BASE}/teachers?${q}&sort=effectiveHours&page=1&pageSize=20&search=` },
  { tag: 'teachers-p2', handler: teachersGET, url: `${BASE}/teachers?${q}&sort=effectiveHours&page=2&pageSize=20&search=` },
  { tag: 'teachers-name', handler: teachersGET, url: `${BASE}/teachers?${q}&sort=name&page=1&pageSize=20&search=` },
  { tag: 'teachers-search-a', handler: teachersGET, url: `${BASE}/teachers?${q}&sort=effectiveHours&page=1&pageSize=20&search=а` },
  { tag: 'teachers-search-ova', handler: teachersGET, url: `${BASE}/teachers?${q}&sort=effectiveHours&page=3&pageSize=20&search=ова` },
  { tag: 'teachers-range', handler: teachersGET, url: `${BASE}/teachers?${RANGE}&${q}&sort=effectiveHours&page=1&pageSize=20&search=` },
  { tag: 'teachers-canceled', handler: teachersGET, url: `${BASE}/teachers?includeCanceled=true&sort=scheduledHours&page=1&pageSize=20&search=` },
  { tag: 'teachers-unit', handler: teachersGET, url: `${BASE}/teachers?${q}&topLevelUnitId=${UNIT_ID}&sort=hours&page=1&pageSize=20&search=` },
  { tag: 'rooms-p1', handler: roomsGET, url: `${BASE}/rooms?${q}&sort=hours&page=1&pageSize=20&search=` },
  { tag: 'rooms-name', handler: roomsGET, url: `${BASE}/rooms?${q}&sort=name&page=1&pageSize=50&search=` },
  { tag: 'rooms-address', handler: roomsGET, url: `${BASE}/rooms?${q}&addressIds=${ADDRESS_ID}&sort=hours&page=1&pageSize=20&search=` },
  { tag: 'rooms-search', handler: roomsGET, url: `${BASE}/rooms?${q}&sort=hours&page=1&pageSize=20&search=а` },
  { tag: 'rooms-range', handler: roomsGET, url: `${BASE}/rooms?${RANGE}&${q}&sort=conflicts&page=1&pageSize=20&search=` },
  { tag: 'meta', handler: metaGET, url: `${BASE}/meta` },
]

for (const c of CASES) {
  const res = await c.handler(new Request(c.url))
  const body = await res.text()
  writeFileSync(join(OUT, `${c.tag}.json`), JSON.stringify({ status: res.status, body }, null, 1))
  console.log(`${c.tag}: ${res.status} ${body.length}B`)
}
console.log(`saved ${CASES.length} golden files to ${OUT}`)
