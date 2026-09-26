/**
 * import-assignment.ts
 *
 * Imports the planned teaching load (планируемая нагрузка) for an academic
 * year from upload/assignment.xlsx into the PlannedLoad table: per educator,
 * the sum of planned hours per schedule period (DateRange).
 *
 * Workbook layout (1-based columns):
 *   A — учебный период ("Семестр 1"…"Семестр 12", "1й год обучения"…)
 *   C — учебный год ("2025-2026 уч. год")
 *   E — дисциплина (clean name, no lesson-form tail)
 *   I — преподаватель: "Фамилия И. О., должность"
 *   J — табельный номер (uniquely identifies the person within the file)
 *   L — подразделение первого уровня
 *   M — количество часов
 *
 * Period mapping (per the business rule): for "Y1-Y2 уч. год" the autumn
 * period is 1 Aug Y1 – 1 Feb Y2 (odd semesters 1,3,5,7,9,11) and the spring
 * period is 1 Feb Y2 – 1 Aug Y2 (even semesters 2,4,6,8,10,12 plus
 * "1й/2й/3й год обучения"). DateRange rows are matched by their local
 * calendar dates; a missing period is created with the same displayText
 * format the schedule importer produces.
 *
 * Educator matching (the careful part):
 *   - candidates = educators (id > 0) whose normalized "фамилия + инициалы"
 *     key (from displayName, or derived from longName) equals the file's;
 *   - several educators may share the key (одинофамильцы) and one educator
 *     may hold several positions, so the position is NOT used;
 *   - instead, each candidate is scored by the number of file disciplines
 *     (column E) that also appear in the candidate's schedule (Subject names
 *     with the lesson-form tail after the last comma stripped);
 *   - the file may contain ПОЛНЫЕ ТЁЗКИ (different tabular numbers, same
 *     ФИО), so matching runs per ФИО-group as an injective assignment:
 *     file teachers of a group are greedily paired to DISTINCT educators
 *     by descending score (pairs need score > 0). A group of one with one
 *     candidate is taken as is; of one with several — the strict maximum
 *     wins; everyone left unpaired (tie or all-zero scores) is logged as
 *     AMBIGUOUS and gets no plan.
 *
 * topLevelUnit for a matched educator is taken from column L (created in
 * the dictionary when missing). The file states hours in ACADEMIC hours;
 * they are converted at import into astronomical minutes (an academic hour
 * = 45 astronomical minutes) — the canonical unit every other minutes
 * column in the schema uses — so the plan and the actual load are directly
 * comparable and all display conversions (×4/3 for the academic mode) work
 * uniformly. Educators absent from the file have no PlannedLoad rows
 * (= 0 in the API). Re-running the script replaces the plan for the
 * affected periods.
 *
 * Usage: bun scripts/import-assignment.ts [file]
 *   default file = ./upload/assignment.xlsx
 */
import ExcelJS from 'exceljs'
import { db } from '../src/lib/db'
import { adaptPlaceholders } from '../src/lib/sql-dialect'
import type { Prisma } from '@prisma/client'
import { invalidateServerCache } from './invalidate-cache'

// ---------- Cell helpers (ExcelJS values can be rich text / formulas) ----------

function cellText(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'number') return String(v)
  if (typeof v === 'object') {
    const obj = v as { richText?: { text: string }[]; text?: unknown; result?: unknown }
    if (Array.isArray(obj.richText)) return obj.richText.map((t) => t.text).join('')
    if (typeof obj.text === 'string') return obj.text // hyperlink cells
    if ('result' in obj) return cellText(obj.result)
  }
  return ''
}

function cellNumber(v: unknown): number | null {
  if (typeof v === 'number') return v
  if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) return Number(v)
  if (typeof v === 'object' && v !== null && 'result' in v) return cellNumber((v as { result: unknown }).result)
  return null
}

// ---------- Normalization ----------

/** Общая нормализация текста: lowercase, ё→е, схлопнутые пробелы. */
const norm = (s: string): string => s.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim()

/**
 * Ключ "фамилия + инициалы" для сопоставления преподавателей: lowercase,
 * ё→е, без пробелов и точек — "Погожев С. В." и "ПОГОЖЕВ С.В." → "погожевсв".
 */
function fioKey(s: string): string {
  return norm(s).replace(/[.\s]+/g, '')
}

/** Ключ из полного ФИО: фамилия + первые буквы остальных слов. */
function fioKeyFromLong(s: string): string | null {
  const parts = norm(s).split(' ').filter(Boolean)
  if (parts.length < 2) return null
  const [surname, ...rest] = parts
  return (surname + rest.map((w) => w[0]).join('')).replace(/[.\s]+/g, '')
}

/**
 * Ключ дисциплины для сопоставления файла с расписанием. Subject.name в БД
 * хранит полный текст с хвостом формы занятия ("Алгебра, лекция"), файл
 * содержит чистое название — хвост после последней запятой отбрасывается.
 */
function subjectKey(dbName: string): string {
  const comma = dbName.lastIndexOf(',')
  const base = comma > 0 ? dbName.slice(0, comma) : dbName
  return norm(base)
}

// ---------- Period mapping ----------

interface PeriodSpec {
  dateFrom: Date
  dateTo: Date
  displayText: string
}

const MONTHS_RU_GEN = [
  '', 'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
]

/** Локальная полночь (так же создают даты DateRange импортёры расписания). */
const localMidnight = (y: number, m1to12: number, d: number) => new Date(y, m1to12 - 1, d)

function periodDisplay(from: Date, to: Date): string {
  const f = `${from.getDate()} ${MONTHS_RU_GEN[from.getMonth() + 1]} ${from.getFullYear()}`
  const t = `${to.getDate()} ${MONTHS_RU_GEN[to.getMonth() + 1]} ${to.getFullYear()}`
  return `${f} - ${t}`
}

/**
 * Учебный период строки файла → осенний (true) или весенний (false).
 * Нечётные семестры — осень; чётные и "Nй год обучения" — весна.
 */
function isAutumnPeriod(label: string): boolean | null {
  const m = label.match(/^Семестр\s+(\d+)\s*$/i)
  if (m) return Number(m[1]) % 2 === 1
  if (/^\dй год обучения$/i.test(label)) return false
  return null
}

/** "2025-2026 уч. год" → 2025 (первый год). */
function parseYearStart(label: string): number | null {
  const m = label.match(/(\d{4})\s*[-–]\s*\d{4}/)
  return m ? Number(m[1]) : null
}

function periodSpecs(y1: number): { autumn: PeriodSpec; spring: PeriodSpec } {
  // Dates as local midnights — the same convention the schedule importer
  // stores in DateRange (new Date("2025-08-01T00:00:00") is local midnight).
  const autumn: PeriodSpec = {
    dateFrom: localMidnight(y1, 8, 1),
    dateTo: localMidnight(y1 + 1, 2, 1),
    displayText: '',
  }
  const spring: PeriodSpec = {
    dateFrom: localMidnight(y1 + 1, 2, 1),
    dateTo: localMidnight(y1 + 1, 8, 1),
    displayText: '',
  }
  autumn.displayText = periodDisplay(autumn.dateFrom, autumn.dateTo)
  spring.displayText = periodDisplay(spring.dateFrom, spring.dateTo)
  return { autumn, spring }
}

/** Академический час = 45 астрономических минут (пара 2 ак.ч = 90 мин). */
const ACADEMIC_MINUTES = 45

// ---------- File model ----------

interface FileTeacher {
  tabular: string
  fio: string // "Фамилия И. О." (до первой запятой в колонке I)
  fioK: string
  subjects: Set<string> // нормализованные дисциплины (E)
  unitCounts: Map<string, number> // L → число строк (берём самый частый)
  minutesByPeriod: Map<string, number> // displayText периода → минуты
}

function intersectionSize(a: Set<string>, b: Set<string> | undefined): number {
  if (!b) return 0
  let n = 0
  for (const x of a) if (b.has(x)) n++
  return n
}

// ---------- Main ----------

async function main() {
  const file = process.argv[2] || './upload/assignment.xlsx'
  const t0 = Date.now()
  console.log(`Importing planned load from: ${file}`)

  // ---- Step 1: parse the workbook ----
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(file)
  const ws = wb.worksheets[0]
  if (!ws) {
    console.error('No worksheet found — aborting.')
    process.exit(1)
  }

  const teachers = new Map<string, FileTeacher>()
  let dataRows = 0
  let skippedUnrecognizedPeriod = 0
  let skippedBadRow = 0

  ws.eachRow({ includeEmpty: false }, (row) => {
    const periodLabel = cellText(row.getCell(1).value).trim() // A
    const yearLabel = cellText(row.getCell(3).value).trim() // C
    const subject = cellText(row.getCell(5).value).trim() // E
    const teacherRaw = cellText(row.getCell(9).value).trim() // I
    const tabularRaw = row.getCell(10).value // J
    const unit = cellText(row.getCell(12).value).trim() // L
    const hours = cellNumber(row.getCell(13).value) // M

    // Header / service rows: no hours, no teacher or no tabular number.
    if (hours === null || !teacherRaw || tabularRaw === null || tabularRaw === undefined) {
      if (cellText(row.getCell(13).value).trim() !== '') skippedBadRow++
      return
    }
    const autumn = isAutumnPeriod(periodLabel)
    const y1 = parseYearStart(yearLabel)
    if (autumn === null || y1 === null) {
      skippedUnrecognizedPeriod++
      console.warn(`  Unrecognized period/year, row skipped: "${periodLabel}" / "${yearLabel}"`)
      return
    }
    dataRows++

    const tabular = cellText(tabularRaw).trim()
    let t = teachers.get(tabular)
    if (!t) {
      const fio = teacherRaw.split(',')[0].trim()
      t = {
        tabular,
        fio,
        fioK: fioKey(fio),
        subjects: new Set(),
        unitCounts: new Map(),
        minutesByPeriod: new Map(),
      }
      teachers.set(tabular, t)
    }
    if (subject) t.subjects.add(norm(subject))
    if (unit) t.unitCounts.set(unit, (t.unitCounts.get(unit) ?? 0) + 1)

    const { autumn: a, spring: s } = periodSpecs(y1)
    const periodText = autumn ? a.displayText : s.displayText
    // Файл задаёт академические часы → сразу переводим в астрономические
    // минуты (канонические единицы схемы), чтобы план и факт сравнивались
    // напрямую и показывались в любом режиме часов без особых веток.
    t.minutesByPeriod.set(
      periodText,
      (t.minutesByPeriod.get(periodText) ?? 0) + Math.round(hours * ACADEMIC_MINUTES),
    )
  })

  console.log(
    `Parsed ${dataRows} rows: ${teachers.size} teacher(s); skipped: ` +
      `${skippedUnrecognizedPeriod} unrecognized period, ${skippedBadRow} bad row(s).`,
  )
  if (dataRows === 0) {
    console.error('No data rows found — aborting.')
    process.exit(1)
  }

  // ---- Step 2: resolve/create DateRange rows for every touched period ----
  const allRanges = await db.dateRange.findMany()
  const findByDates = (spec: PeriodSpec) =>
    allRanges.find(
      (d) =>
        d.dateFrom.getFullYear() === spec.dateFrom.getFullYear() &&
        d.dateFrom.getMonth() === spec.dateFrom.getMonth() &&
        d.dateFrom.getDate() === spec.dateFrom.getDate() &&
        d.dateTo.getFullYear() === spec.dateTo.getFullYear() &&
        d.dateTo.getMonth() === spec.dateTo.getMonth() &&
        d.dateTo.getDate() === spec.dateTo.getDate(),
    )

  // Какие периоды вообще встречаются в файле — выводим из реальных лет.
  const yearsInFile = new Set<number>()
  for (const t of teachers.values()) {
    // displayText однозначно кодирует период; года восстановим перебором
    // разумного диапазона (см. periodSpecs).
    for (const text of t.minutesByPeriod.keys()) {
      for (let y1 = 2020; y1 <= 2035; y1++) {
        const { autumn, spring } = periodSpecs(y1)
        if (text === autumn.displayText || text === spring.displayText) yearsInFile.add(y1)
      }
    }
  }

  const periodIdByText = new Map<string, number>()
  for (const y1 of yearsInFile) {
    for (const spec of [periodSpecs(y1).autumn, periodSpecs(y1).spring]) {
      if (![...teachers.values()].some((t) => t.minutesByPeriod.has(spec.displayText))) continue
      const existing = findByDates(spec)
      if (existing) {
        periodIdByText.set(spec.displayText, existing.id)
      } else {
        const created = await db.dateRange.create({
          data: spec,
          select: { id: true, displayText: true },
        })
        periodIdByText.set(spec.displayText, created.id)
        console.log(`  Created DateRange "${spec.displayText}" (id=${created.id}).`)
      }
    }
  }

  // ---- Step 3: educator candidates by normalized ФИО ----
  const educators = await db.educator.findMany({
    where: { id: { gt: 0 } },
    select: { id: true, displayName: true, longName: true },
  })
  const candidatesByKey = new Map<string, { id: number; displayName: string }[]>()
  for (const e of educators) {
    const keys = new Set(
      [fioKey(e.displayName), fioKeyFromLong(e.longName)].filter(Boolean) as string[],
    )
    for (const key of keys) {
      const list = candidatesByKey.get(key) ?? []
      list.push({ id: e.id, displayName: e.displayName })
      candidatesByKey.set(key, list)
    }
  }

  // ---- Step 4: schedule subjects per candidate (для сопоставления по дисциплинам) ----
  const candidateIds = new Set<number>()
  for (const t of teachers.values()) {
    for (const c of candidatesByKey.get(t.fioK) ?? []) candidateIds.add(c.id)
  }
  const subjectsByEducator = new Map<number, Set<string>>()
  const ids = [...candidateIds]
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500)
    const sql = `SELECT DISTINCT se."educatorId" AS eid, s."name" AS name
                   FROM "ScheduleEvent" se JOIN "Subject" s ON s."id" = se."subjectId"
                  WHERE se."educatorId" IN (${chunk.map(() => '?').join(',')})`
    const pairs = (await db.$queryRawUnsafe(adaptPlaceholders(sql), ...chunk)) as Array<{
      eid: number | bigint
      name: string
    }>
    for (const p of pairs) {
      const eid = Number(p.eid)
      let set = subjectsByEducator.get(eid)
      if (!set) {
        set = new Set()
        subjectsByEducator.set(eid, set)
      }
      set.add(subjectKey(p.name))
    }
  }

  // ---- Step 5: match file teachers to educators ----
  // Полные тёзки в файле (одно ФИО, разные табельные) должны разойтись по
  // РАЗНЫМ преподавателям БД — поэтому сопоставление выполняется по группам
  // ФИО как инъективное назначение, а не построчно.
  interface Match {
    teacher: FileTeacher
    educatorId: number
    unit: string
    score: number
  }
  const matches: Match[] = []
  const notFound: string[] = []
  const ambiguous: string[] = []

  const groups = new Map<string, FileTeacher[]>()
  for (const t of teachers.values()) {
    if (!candidatesByKey.has(t.fioK)) {
      notFound.push(`${t.fio} (таб. ${t.tabular})`)
      continue
    }
    const list = groups.get(t.fioK) ?? []
    list.push(t)
    groups.set(t.fioK, list)
  }

  for (const [key, group] of groups) {
    const cands = [...new Map((candidatesByKey.get(key) ?? []).map((c) => [c.id, c])).values()]
      .sort((a, b) => a.id - b.id)
    const unitOf = (t: FileTeacher) =>
      [...t.unitCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? ''

    // score[gi][ci] — пересечение дисциплин файла с расписанием кандидата.
    const score = group.map((t) => cands.map((c) => intersectionSize(t.subjects, subjectsByEducator.get(c.id))))

    const assign = new Map<number, number>() // gi -> ci
    if (group.length === 1 && cands.length === 1) {
      // Обычный случай: единственный кандидат — берём даже при нуле.
      assign.set(0, 0)
    } else if (group.length === 1) {
      // Один в файле, несколько в БД: нужен строгий максимум (при ничьей
      // или нулях оставляем AMBIGUOUS).
      const row = score[0]
      const max = Math.max(...row)
      const winners = row.flatMap((s, ci) => (s === max ? [ci] : []))
      if (max > 0 && winners.length === 1) assign.set(0, winners[0])
    } else {
      // Полные тёзки: жадное инъективное назначение по убыванию счёта.
      const usedCands = new Set<number>()
      const pairs: { gi: number; ci: number; s: number }[] = []
      for (let gi = 0; gi < group.length; gi++) {
        for (let ci = 0; ci < cands.length; ci++) pairs.push({ gi, ci, s: score[gi][ci] })
      }
      // Порядок детерминирован: счёт ↓, табельный ↑ (стабильный порядок
      // группы), id кандидата ↑.
      pairs.sort((a, b) => b.s - a.s || a.gi - b.gi || cands[a.ci].id - cands[b.ci].id)
      for (const p of pairs) {
        if (p.s <= 0) break // дальше все нули
        if (assign.has(p.gi) || usedCands.has(p.ci)) continue
        assign.set(p.gi, p.ci)
        usedCands.add(p.ci)
      }
    }

    for (let gi = 0; gi < group.length; gi++) {
      const ci = assign.get(gi)
      if (ci === undefined) {
        ambiguous.push(
          `${group[gi].fio} (таб. ${group[gi].tabular}): ` +
            cands.map((c, i) => `${c.displayName}#${c.id}=${score[gi][i]}`).join(', '),
        )
        continue
      }
      matches.push({ teacher: group[gi], educatorId: cands[ci].id, unit: unitOf(group[gi]), score: score[gi][ci] })
    }
  }

  console.log(
    `Matched ${matches.length}/${teachers.size}; not found: ${notFound.length}; ambiguous: ${ambiguous.length}.`,
  )
  for (const n of notFound.slice(0, 20)) console.warn(`  NOT FOUND: ${n}`)
  if (notFound.length > 20) console.warn(`  … and ${notFound.length - 20} more`)
  for (const a of ambiguous.slice(0, 20)) console.warn(`  AMBIGUOUS: ${a}`)
  if (ambiguous.length > 20) console.warn(`  … and ${ambiguous.length - 20} more`)

  // ---- Step 6: upsert units, write plan (single transaction) ----
  const unitCache = new Map<string, number>()
  for (const u of await db.topLevelUnit.findMany({ select: { id: true, name: true } })) {
    unitCache.set(u.name, u.id)
  }

  const affectedRangeIds = new Set<number>()
  for (const m of matches) {
    for (const text of m.teacher.minutesByPeriod.keys()) {
      const rid = periodIdByText.get(text)
      if (rid !== undefined) affectedRangeIds.add(rid)
    }
  }

  let unitsCreated = 0
  await db.$transaction(
    async (tx) => {
      // Подразделение первого уровня — из файла (колонка L); одна пакетная
      // updateMany на подразделение вместо update на преподавателя.
      const byUnit = new Map<string, number[]>()
      for (const m of matches) {
        if (!m.unit) continue
        const list = byUnit.get(m.unit) ?? []
        list.push(m.educatorId)
        byUnit.set(m.unit, list)
      }
      for (const [unit, educatorIds] of byUnit) {
        let unitId = unitCache.get(unit)
        if (unitId === undefined) {
          const created = await tx.topLevelUnit.create({
            data: { name: unit },
            select: { id: true },
          })
          unitCache.set(unit, created.id)
          unitsCreated++
        }
        await tx.educator.updateMany({
          where: { id: { in: educatorIds } },
          data: { topLevelUnitId: unitCache.get(unit)! },
        })
      }

      // Полная перезагрузка плана для затронутых периодов.
      await tx.plannedLoad.deleteMany({ where: { dateRangeId: { in: [...affectedRangeIds] } } })

      const creates: Prisma.PlannedLoadCreateManyInput[] = []
      const seen = new Set<string>()
      for (const m of matches) {
        for (const [periodText, minutes] of m.teacher.minutesByPeriod) {
          const dateRangeId = periodIdByText.get(periodText)
          if (dateRangeId === undefined || minutes <= 0) continue
          // Страховка от дублей (educatorId уже занят другим табельным
          // номером тёзки) — после инъективного назначения не должно
          // встречаться, но молча задвоить план хуже, чем заметить.
          const dedupeKey = `${m.educatorId}:${dateRangeId}`
          if (seen.has(dedupeKey)) continue
          seen.add(dedupeKey)
          creates.push({ educatorId: m.educatorId, dateRangeId, plannedMinutes: minutes })
        }
      }
      if (creates.length > 0) await tx.plannedLoad.createMany({ data: creates })

      console.log(
        `Wrote ${creates.length} PlannedLoad row(s) for ${new Set(matches.map((m) => m.educatorId)).size} educator(s); units created: ${unitsCreated}.`,
      )
    },
    // Как в import-schedules: на полной базе запись идёт дольше дефолтных 5 c.
    { maxWait: 60_000, timeout: 7_200_000 },
  )

  // ---- Step 7: summary ----
  const totalMinutes = await db.plannedLoad.aggregate({ _sum: { plannedMinutes: true } })
  console.log(`Total planned minutes in DB: ${Number(totalMinutes._sum.plannedMinutes ?? 0)}.`)
  console.log(`Done in ${((Date.now() - t0) / 1000).toFixed(2)}s.`)

  await invalidateServerCache()
}

main()
  .then(() => db.$disconnect())
  .catch((e) => {
    console.error(e)
    return db.$disconnect().then(() => process.exit(1))
  })
