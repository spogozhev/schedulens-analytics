/**
 * Compares analytics endpoint responses against "golden" files saved by
 * golden-save.ts before the raw-SQL rewrite. Verifies the rewrite produces
 * identical results.
 *
 * Usage:
 *   DATABASE_URL="file:<db>" GOLDEN_DIR=/tmp/tta-golden/<tag> DB_LOG_SLOW_MS=-1 \
 *     bun scripts/golden-check.ts
 */
import { readFileSync, readdirSync } from 'node:fs'
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
const GOLDEN = process.env.GOLDEN_DIR ?? '/tmp/tta-golden/run'
const q = 'includeCanceled=false'
const RANGE = 'dateRangeIds=1'

const HANDLERS: Record<string, (r: Request) => Promise<Response>> = {
  kpi: kpiGET, 'by-kind': byKindGET, 'by-lesson-form': byLessonFormGET,
  heatmap: heatmapGET, timeline: timelineGET,
  'top-teachers': topTeachersGET, 'top-rooms': topRoomsGET,
  teachers: teachersGET, rooms: roomsGET, meta: metaGET,
}

// Same case list as golden-save.ts (tags must match).
const CASES: Array<{ tag: string; url: string }> = [
  { tag: 'kpi-all', url: `${BASE}/kpi?${q}` },
  { tag: 'kpi-range', url: `${BASE}/kpi?${RANGE}&${q}` },
  { tag: 'kpi-kind2', url: `${BASE}/kpi?kindCode=2&${q}` },
  { tag: 'kpi-canceled', url: `${BASE}/kpi?includeCanceled=true` },
  { tag: 'kpi-form', url: `${BASE}/kpi?lessonFormIds=1&${q}` },
  { tag: 'by-kind-all', url: `${BASE}/by-kind?${q}` },
  { tag: 'by-lesson-form-all', url: `${BASE}/by-lesson-form?${q}` },
  { tag: 'heatmap-all', url: `${BASE}/heatmap?${q}` },
  { tag: 'heatmap-range', url: `${BASE}/heatmap?${RANGE}&${q}` },
  { tag: 'timeline-week', url: `${BASE}/timeline?${q}&granularity=week` },
  { tag: 'timeline-day', url: `${BASE}/timeline?${q}&granularity=day` },
  { tag: 'timeline-range', url: `${BASE}/timeline?${RANGE}&${q}&granularity=week` },
  { tag: 'top-teachers-10', url: `${BASE}/top-teachers?${q}&limit=10` },
  { tag: 'top-teachers-3', url: `${BASE}/top-teachers?${q}&limit=3` },
  { tag: 'top-teachers-range', url: `${BASE}/top-teachers?${RANGE}&${q}` },
  { tag: 'top-rooms-10', url: `${BASE}/top-rooms?${q}&limit=10` },
  { tag: 'top-rooms-range', url: `${BASE}/top-rooms?${RANGE}&${q}` },
  { tag: 'teachers-p1', url: `${BASE}/teachers?${q}&sort=effectiveHours&page=1&pageSize=20&search=` },
  { tag: 'teachers-p2', url: `${BASE}/teachers?${q}&sort=effectiveHours&page=2&pageSize=20&search=` },
  { tag: 'teachers-name', url: `${BASE}/teachers?${q}&sort=name&page=1&pageSize=20&search=` },
  { tag: 'teachers-search-a', url: `${BASE}/teachers?${q}&sort=effectiveHours&page=1&pageSize=20&search=а` },
  { tag: 'teachers-search-ova', url: `${BASE}/teachers?${q}&sort=effectiveHours&page=3&pageSize=20&search=ова` },
  { tag: 'teachers-range', url: `${BASE}/teachers?${RANGE}&${q}&sort=effectiveHours&page=1&pageSize=20&search=` },
  { tag: 'teachers-canceled', url: `${BASE}/teachers?includeCanceled=true&sort=scheduledHours&page=1&pageSize=20&search=` },
  { tag: 'teachers-unit', url: `${BASE}/teachers?${q}&topLevelUnitId=${UNIT_ID}&sort=hours&page=1&pageSize=20&search=` },
  { tag: 'rooms-p1', url: `${BASE}/rooms?${q}&sort=hours&page=1&pageSize=20&search=` },
  { tag: 'rooms-address', url: `${BASE}/rooms?${q}&addressIds=${ADDRESS_ID}&sort=hours&page=1&pageSize=20&search=` },
  { tag: 'rooms-name', url: `${BASE}/rooms?${q}&sort=name&page=1&pageSize=50&search=` },
  { tag: 'rooms-search', url: `${BASE}/rooms?${q}&sort=hours&page=1&pageSize=20&search=а` },
  { tag: 'rooms-range', url: `${BASE}/rooms?${RANGE}&${q}&sort=conflicts&page=1&pageSize=20&search=` },
  { tag: 'meta', url: `${BASE}/meta` },
]

type Json = any

function deepEqual(a: Json, b: Json, path: string, diffs: string[]) {
  if (diffs.length > 8) return
  if (a === b) return
  if (typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) < 1e-9) return
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) { diffs.push(`${path}: length ${a.length} != ${b.length}`); return }
    for (let i = 0; i < a.length; i++) deepEqual(a[i], b[i], `${path}[${i}]`, diffs)
    return
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)])
    for (const k of keys) deepEqual(a[k], b[k], `${path}.${k}`, diffs)
    return
  }
  diffs.push(`${path}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`)
}

function sortBy(arr: any[], key: (x: any) => string | number): any[] {
  return [...arr].sort((x, y) => (key(x) < key(y) ? -1 : key(x) > key(y) ? 1 : 0))
}

// Normalizers: canonical form per endpoint (sort arrays whose order may
// legitimately differ on ties between implementations).
const NORMALIZERS: Record<string, (d: Json) => Json> = {
  'by-kind': (d) => ({ byKind: sortBy(d.byKind, (x) => x.kindCode) }),
  'by-lesson-form': (d) => ({ byLessonForm: sortBy(d.byLessonForm, (x) => x.name) }),
  heatmap: (d) => d,
  timeline: (d) => ({ granularity: d.granularity, timeline: sortBy(d.timeline, (x) => x.key) }),
  'top-teachers': (d) => ({ topTeachers: sortBy(d.topTeachers, (x) => x.id) }),
  'top-rooms': (d) => ({ topRooms: sortBy(d.topRooms, (x) => x.id) }),
  teachers: (d) => ({
    sort: d.sort, search: d.search, page: d.page, pageSize: d.pageSize,
    total: d.total, totalPages: d.totalPages,
    items: sortBy(d.items, (x) => x.id),
  }),
  rooms: (d) => ({
    sort: d.sort, search: d.search, page: d.page, pageSize: d.pageSize,
    total: d.total, totalPages: d.totalPages,
    items: sortBy(d.items, (x) => x.id),
  }),
  kpi: (d) => d,
  meta: (d) => d,
}

function base(tag: string): string {
  return tag.replace(/-(all|range|week|day|p\d+|kind2|canceled|form|address|unit|name|search.*|\d+)$/, '')
}

let pass = 0
let fail = 0
for (const c of CASES) {
  const file = join(GOLDEN, `${c.tag}.json`)
  if (!readdirSync(GOLDEN).includes(`${c.tag}.json`)) { console.log(`MISSING GOLDEN ${c.tag}`); fail++; continue }
  const golden = JSON.parse(readFileSync(file, 'utf8'))
  const goldenBody = typeof golden.body === 'string' ? JSON.parse(golden.body) : golden.body
  const handler = HANDLERS[base(c.tag)]
  const res = await handler(new Request(c.url))
  const body = await res.json()
  const norm = NORMALIZERS[base(c.tag)]
  const diffs: string[] = []
  deepEqual(norm(goldenBody), norm(body), c.tag, diffs)
  if (diffs.length === 0) { pass++; console.log(`OK   ${c.tag}`) }
  else { fail++; console.log(`DIFF ${c.tag}`); for (const d of diffs.slice(0, 8)) console.log(`     ${d}`) }
}
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail > 0 ? 1 : 0)
