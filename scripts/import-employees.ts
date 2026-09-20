/**
 * Imports the current-employee file (upload/employees.json) and assigns each
 * educator their first-level unit (top_level_unit).
 *
 * Matching (see analysis):
 *   1. Records and educators are joined by NORMALIZED full name
 *      (lowercase, ё→е, collapsed spaces).
 *   2. Groups where several educators share one ФИО (and/or one ФИО has
 *      several records) are resolved by comparing positions: each
 *      educator↔record pair is scored (+10 when Position AND
 *      second_level_unit match the educator's Employment, +1 for Position
 *      only) and the assignment with the unique best total wins.
 *   3. Ties and zero-overlap groups stay unassigned (allowed).
 *
 * For an employee with several positions the unit of the best-matching
 * position is used (the first position wins ties).
 *
 * EmployeeMatch stores the stable file id → Educator.id mapping so repeated
 * imports stay consistent. Stale mappings are removed.
 *
 * Usage:
 *   DATABASE_URL="file:<abs path to db>" bun scripts/import-employees.ts [employees.json]
 */
import fs from 'fs/promises'
import { db } from '../src/lib/db'
import { isSqlite } from '../src/lib/sql-dialect'
import { invalidateServerCache } from './invalidate-cache'
import type { Prisma } from '@prisma/client'

const norm = (s: string): string => s.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim()

interface FilePosition {
  top_level_unit: string
  second_level_unit?: string
  position: string
}

interface FileEmployee {
  id: string
  name: string
  positions: FilePosition[]
}

interface Cand {
  id: number
  topLevelUnitId: number | null
  emp: { p: string; d: string }[]
}

/**
 * Order-independent matching: +10 when the file position matches an
 * employment's position AND second-level unit, +1 for a position-only match.
 * (Employment row order varies between DBMS — never rely on find-first.)
 */
/**
 * Order-independent department match: exact, inclusion, or equal last-two
 * tokens — so abbreviated names ("каф.осадочной геологии") match full ones
 * ("Кафедра осадочной геологии").
 */
function departmentsMatch(a: string, b: string): boolean {
  if (!a || !b) return false
  if (a === b) return true
  if (a.includes(b) || b.includes(a)) return true
  const ta = a.split(' ')
  const tb = b.split(' ')
  return ta.length >= 2 && tb.length >= 2 && ta[ta.length - 1] === tb[tb.length - 1] && ta[ta.length - 2] === tb[tb.length - 2]
}

/**
 * Order-independent matching of a file position against an educator's
 * employments. The position text may list several posts ("внс, профессор") —
 * split by commas.
 */
function positionScore(cand: Cand, pn: string, dn: string): number {
  let best = 0
  for (const part of pn.split(',')) {
    const p = part.trim()
    if (!p) continue
    for (const em of cand.emp) {
      if (em.p !== p) continue
      const s = departmentsMatch(em.d, dn) ? 10 : 1
      if (s > best) best = s
    }
  }
  return best
}

function scorePair(cand: Cand | undefined, entry: FileEmployee): number {
  let score = 0
  for (const p of entry.positions || []) {
    score += positionScore(cand ?? { id: 0, topLevelUnitId: null, emp: [] }, norm(p.position), norm(p.second_level_unit || ''))
  }
  return score
}

function scoreAssignment(cands: Cand[], entries: FileEmployee[], pairs: { candIdx: number; entryIdx: number }[]): number {
  return pairs.reduce((s, p) => s + scorePair(cands[p.candIdx], entries[p.entryIdx]), 0)
}

/** All k-sized combinations of arr. */
function* combinations(arr: number[], k: number): Generator<number[]> {
  const n = arr.length
  if (k <= 0) { yield []; return }
  if (k > n) return
  for (let i = 0; i <= n - k; i++) {
    for (const rest of combinations(arr.slice(i + 1), k - 1)) yield [arr[i], ...rest]
  }
}

/** All permutations of arr. */
function* permutations(arr: number[]): Generator<number[]> {
  if (arr.length <= 1) { yield arr.slice(); return }
  for (let i = 0; i < arr.length; i++) {
    const rest = [...arr.slice(0, i), ...arr.slice(i + 1)]
    for (const p of permutations(rest)) yield [arr[i], ...p]
  }
}

interface Assignment {
  pairs: { candIdx: number; entryIdx: number }[]
  score: number
}

/**
 * Best assignment of candidates to entries (at most one record per
 * candidate; unmatched records allowed). Exhaustive for small groups;
 * greedy fallback for oversized ones.
 */
function bestAssignment(cands: Cand[], entries: FileEmployee[]): Assignment | null {
  const k = Math.min(cands.length, entries.length)
  if (k === 0) return null
  if (k > 7) {
    // Greedy fallback: repeatedly take the globally best-scoring pair.
    const pairs: { candIdx: number; entryIdx: number }[] = []
    const usedC = new Set<number>()
    const usedE = new Set<number>()
    let score = 0
    for (let step = 0; step < k; step++) {
      let bestP: { candIdx: number; entryIdx: number } | null = null
      let bestScore = 0
      for (let ci = 0; ci < cands.length; ci++) {
        if (usedC.has(ci)) continue
        for (let ei = 0; ei < entries.length; ei++) {
          if (usedE.has(ei)) continue
          const s = scorePair(cands[ci], entries[ei])
          if (s > bestScore) { bestScore = s; bestP = { candIdx: ci, entryIdx: ei } }
        }
      }
      if (!bestP) break
      usedC.add(bestP.candIdx)
      usedE.add(bestP.entryIdx)
      pairs.push(bestP)
      score += bestScore
    }
    return { pairs, score }
  }
  const candIdxs = [...cands.keys()]
  const entryIdxs = [...entries.keys()]
  let best: Assignment | null = null
  // Every candidate-subset × entry-subset × pairing must be considered:
  // which candidates fall into the first k depends on DB row order.
  for (const candSub of combinations(candIdxs, k)) {
    for (const entrySub of combinations(entryIdxs, k)) {
      for (const candPerm of permutations(candSub)) {
        const pairs = candPerm.map((candIdx, i) => ({ candIdx, entryIdx: entrySub[i] }))
        const score = scoreAssignment(cands, entries, pairs)
        if (!best || score > best.score) best = { pairs, score }
      }
    }
  }
  return best
}

/** Sorted distinct total scores of all assignments — for strictness check. */
function assignmentScores(cands: Cand[], entries: FileEmployee[]): number[] {
  const k = Math.min(cands.length, entries.length)
  if (k === 0) return [0]
  const candIdxs = [...cands.keys()]
  const entryIdxs = [...entries.keys()]
  const scores: number[] = []
  for (const candSub of combinations(candIdxs, k)) {
    for (const entrySub of combinations(entryIdxs, k)) {
      for (const candPerm of permutations(candSub)) {
        const pairs = candPerm.map((candIdx, i) => ({ candIdx, entryIdx: entrySub[i] }))
        scores.push(scoreAssignment(cands, entries, pairs))
      }
    }
  }
  return [...new Set(scores)].sort((a, b) => b - a)
}

/** Unit of the entry position that best matches this educator's employments. */
function unitFor(cand: Cand, entry: FileEmployee): string | null {
  const positions = entry.positions || []
  if (positions.length === 0) return null
  let bestIdx = 0
  let bestScore = -1
  positions.forEach((p, idx) => {
    const s = positionScore(cand, norm(p.position), norm(p.second_level_unit || ''))
    if (s > bestScore) { bestScore = s; bestIdx = idx }
  })
  return positions[bestIdx].top_level_unit || null
}

async function main(): Promise<void> {
  const filePath = process.argv[2] || './upload/employees.json'
  const data: FileEmployee[] = JSON.parse(await fs.readFile(filePath, 'utf-8'))
  const seenFileIds = new Set<string>()
  for (const e of data) if (e.id) seenFileIds.add(String(e.id))
  console.log(`Loaded ${data.length} employee records from ${filePath}`)

  if (isSqlite) {
    await db.$queryRawUnsafe('PRAGMA cache_size = -134217728')
    await db.$queryRawUnsafe('PRAGMA temp_store = MEMORY')
  }

  const educators = await db.educator.findMany({
    select: { id: true, longName: true, topLevelUnitId: true },
  })
  const empRows = await db.employment.findMany({
    select: { educatorId: true, position: true, department: { select: { name: true } } },
  })
  const empOf = new Map<number, { p: string; d: string }[]>()
  for (const r of empRows) {
    const list = empOf.get(r.educatorId) ?? []
    list.push({ p: norm(r.position), d: norm(r.department?.name ?? '') })
    empOf.set(r.educatorId, list)
  }

  // Group educators by normalized ФИО and build the file groups.
  const eduByName = new Map<string, Cand[]>()
  for (const e of educators) {
    const n = norm(e.longName)
    const cand: Cand = { id: e.id, topLevelUnitId: e.topLevelUnitId, emp: empOf.get(e.id) ?? [] }
    const list = eduByName.get(n)
    if (list) list.push(cand)
    else eduByName.set(n, [cand])
  }
  // Canonical candidate order (by id): makes tie-breaking deterministic
  // across DBMS, where findMany row order differs.
  for (const list of eduByName.values()) list.sort((a, b) => a.id - b.id)
  const fileByName = new Map<string, FileEmployee[]>()
  for (const e of data) {
    const n = norm(e.name)
    const list = fileByName.get(n)
    if (list) list.push(e)
    else fileByName.set(n, [e])
  }

  let directLinked = 0
  let assignStrict = 0
  let assignTied = 0
  let assignZero = 0
  let educatorsLinked = 0
  const ambiguousNames: string[] = []
  const unitCache = new Map<string, number>()

  const getUnitId = async (tx: Prisma.TransactionClient, name: string): Promise<number> => {
    const cached = unitCache.get(name)
    if (cached !== undefined) return cached
    const row = await tx.topLevelUnit.upsert({
      where: { name },
      create: { name },
      update: {},
      select: { id: true },
    })
    unitCache.set(name, row.id)
    return row.id
  }

  await db.$transaction(
    async (tx) => {
      // The file is authoritative: reset all assignments so the result is a
      // pure function of (employees.json × Employment) — identical across
      // SQLite and PostgreSQL regardless of import history.
      await tx.educator.updateMany({ data: { topLevelUnitId: null } })
      // Invalidate the preloaded snapshot to match the reset state.
      for (const list of eduByName.values()) for (const c of list) c.topLevelUnitId = null
      for (const [name, entries] of fileByName) {
        const cands = eduByName.get(name) ?? []
        if (cands.length === 0) continue // staff without timetable events and without Educator row

        const educatorIds = new Set(cands.map((c) => c.id))
        if (cands.length === 1 && entries.length === 1) {
          // Direct 1:1 match.
          const cand = cands[0]
          const unitName = unitFor(cand, entries[0])
          const unitId = unitName ? await getUnitId(tx, unitName) : null
          if (unitId !== cand.topLevelUnitId) {
            await tx.educator.update({ where: { id: cand.id }, data: { topLevelUnitId: unitId } })
            educatorsLinked++
          }
          seenFileIds.add(String(entries[0].id))
          await tx.employeeMatch.upsert({
            where: { fileId: String(entries[0].id) },
            create: { fileId: String(entries[0].id), educatorId: cand.id, score: scorePair(cand, entries[0]) },
            update: { educatorId: cand.id, score: scorePair(cand, entries[0]) },
          })
          directLinked++
          continue
        }

        // Ambiguous group: bipartite assignment by employment overlap.
        // Only educators with known employments participate in scoring.
        const candsWithEmp = cands.filter((c) => c.emp.length > 0)
        const group = candsWithEmp.length > 0 ? candsWithEmp : cands
        const best = bestAssignment(group, entries)
        if (!best || best.score === 0) { assignZero++; ambiguousNames.push(name); continue }
        const scores = assignmentScores(group, entries)
        if (scores.length > 1 && scores[0] === scores[1]) { assignTied++; ambiguousNames.push(name); continue }
        assignStrict++

        for (const pair of best.pairs) {
          const cand = group[pair.candIdx]
          const entry = entries[pair.entryIdx]
          const unitName = unitFor(cand, entry)
          const unitId = unitName ? await getUnitId(tx, unitName) : null
          if (unitId !== cand.topLevelUnitId) {
            await tx.educator.update({ where: { id: cand.id }, data: { topLevelUnitId: unitId } })
            educatorsLinked++
          }
          seenFileIds.add(String(entry.id))
          await tx.employeeMatch.upsert({
            where: { fileId: String(entry.id) },
            create: { fileId: String(entry.id), educatorId: cand.id, score: scorePair(cand, entry) },
            update: { educatorId: cand.id, score: scorePair(cand, entry) },
          })
        }
      }

      // Drop mappings that are no longer present in the current file.
      await tx.employeeMatch.deleteMany({
        where: { fileId: { notIn: [...seenFileIds] } },
      })
    },
    { maxWait: 60_000, timeout: 1_800_000 },
  )

  const educatorsWithUnit = await db.educator.count({ where: { topLevelUnitId: { not: null } } })
  const units = await db.topLevelUnit.count()
  console.log('--- Summary ---')
  console.log(`Direct 1:1 ФИО matches linked: ${directLinked}`)
  console.log(`Assignment groups: strict ${assignStrict}, tied ${assignTied}, zero-overlap ${assignZero}`)
  if (ambiguousNames.length > 0) console.log(`  ambiguous ФИО: ${ambiguousNames.join('; ')}`)
  console.log(`Educators linked to a top-level unit (set/updated this run): ${educatorsLinked}`)
  console.log(`Educator rows with a top-level unit: ${educatorsWithUnit} of ${educators.length}`)
  console.log(`Top-level units in dictionary: ${units}`)

  // Unit assignments feed the analytics cache — drop it.
  await invalidateServerCache();
}

main()
  .then(() => db.$disconnect())
  .catch((e) => {
    console.error(e)
    return db.$disconnect().then(() => process.exit(1))
  })
