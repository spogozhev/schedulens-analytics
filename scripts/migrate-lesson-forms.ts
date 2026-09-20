// @ts-nocheck — dev-only migration script; bun:sqlite types are not installed.
/**
 * Backfills ScheduleEvent.lessonFormId from the Subject names using the
 * lesson-forms dictionary (scripts/lesson-forms.ts).
 *
 * ScheduleEvent.dateRangeId is intentionally NOT backfilled: the
 * DateRangeDisplayText of legacy rows was never stored, so it cannot be
 * reconstructed — a re-import fills it in (the importer enriches legacy
 * rows on the duplicate-skip path).
 *
 * Idempotent: only rows with lessonFormId IS NULL are touched.
 *
 * Usage:
 *   DATABASE_URL="file:<abs path to db>" bun scripts/migrate-lesson-forms.ts
 */
import { Database } from 'bun:sqlite'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { LESSON_FORMS, extractLessonForm } from './lesson-forms'

// `file:` URLs may carry query params; bun auto-loads .env where DATABASE_URL
// is relative to the prisma/ dir — try cwd-relative first, then prisma-relative.
function resolveDbPath(url: string): string {
  const p = url.replace(/^file:/, '').split('?')[0]
  if (existsSync(p)) return p
  const viaPrisma = resolve(process.cwd(), 'prisma', p)
  if (existsSync(viaPrisma)) return viaPrisma
  return p
}
const dbPath = resolveDbPath(process.env.DATABASE_URL ?? 'file:./db/custom.db')

const db = new Database(dbPath)
db.exec('PRAGMA journal_mode = WAL')

const eventsTotal = db.query('SELECT COUNT(*) c FROM ScheduleEvent').get().c
const withForm = db.query('SELECT COUNT(*) c FROM ScheduleEvent WHERE lessonFormId IS NOT NULL').get().c
console.log(`events: ${eventsTotal}, with lessonFormId already: ${withForm}`)

db.exec('BEGIN')
try {
  // Seed the LessonForm dictionary (canonical names).
  const insForm = db.prepare('INSERT INTO LessonForm (name) VALUES (?) ON CONFLICT(name) DO NOTHING')
  for (const name of LESSON_FORMS) insForm.run(name)

  const formIdByName = new Map(
    db.query('SELECT id, name FROM LessonForm').all().map((r) => [r.name, r.id]),
  )

  // Resolve a lesson form per subject (null when the name has no form tail).
  const subjects = db.query('SELECT id, name FROM Subject').all()
  const upd = db.prepare('UPDATE ScheduleEvent SET lessonFormId = ? WHERE subjectId = ? AND lessonFormId IS NULL')
  let subjectsWithForm = 0
  let updated = 0
  for (const s of subjects) {
    const form = extractLessonForm(s.name)
    if (!form) continue
    const formId = formIdByName.get(form)
    if (!formId) continue
    subjectsWithForm++
    const res = upd.run(formId, s.id)
    updated += Number(res.changes)
  }
  console.log(`subjects with a recognized form: ${subjectsWithForm}/${subjects.length}`)
  console.log(`events updated: ${updated}`)
  db.exec('COMMIT')
} catch (e) {
  db.exec('ROLLBACK')
  throw e
}

const after = db.query('SELECT COUNT(*) c FROM ScheduleEvent WHERE lessonFormId IS NOT NULL').get().c
const byForm = db
  .query(`
    SELECT lf.name AS name, COUNT(*) AS c
      FROM ScheduleEvent se JOIN LessonForm lf ON lf.id = se.lessonFormId
     GROUP BY lf.name ORDER BY c DESC LIMIT 15
  `)
  .all()
console.log(`events with lessonFormId after backfill: ${after}`)
for (const r of byForm) console.log(`  ${String(r.c).padStart(8)} ${r.name}`)
db.close()
