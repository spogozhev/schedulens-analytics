// @ts-nocheck — dev-only migration script; bun:sqlite types are not installed.
/**
 * One-time data migration: fills the Department dictionary from the
 * Employment.department text and links Employment rows to it
 * (Employment.departmentId). Rows with an empty department text are left
 * without a department (departmentId = NULL).
 *
 * Idempotent: re-running only fills missing values. Run `prisma db push`
 * first so Department / Employment.departmentId exist.
 *
 * Usage:
 *   DATABASE_URL="file:<abs path to db>" bun scripts/migrate-departments.ts
 */
import { Database } from 'bun:sqlite'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

function resolveDbPath(url: string): string {
  const p = url.replace(/^file:/, '').split('?')[0]
  if (existsSync(p)) return p
  const viaPrisma = resolve(process.cwd(), 'prisma', p)
  if (existsSync(viaPrisma)) return viaPrisma
  return p
}
const db = new Database(resolveDbPath(process.env.DATABASE_URL ?? 'file:./db/custom.db'))
db.exec('PRAGMA journal_mode = WAL')

const total = db.query('SELECT COUNT(*) c FROM Employment').get().c
const linkedBefore = db.query('SELECT COUNT(*) c FROM Employment WHERE departmentId IS NOT NULL').get().c

db.exec('BEGIN')
try {
  db.exec(`
    INSERT INTO Department (name)
    SELECT DISTINCT department FROM Employment
     WHERE department IS NOT NULL AND department != '' AND departmentId IS NULL
    ORDER BY department
  `)
  db.exec(`
    UPDATE Employment
       SET departmentId = (SELECT id FROM Department WHERE name = Employment.department)
     WHERE departmentId IS NULL AND department IS NOT NULL AND department != ''
  `)
  db.exec('COMMIT')
} catch (e) {
  db.exec('ROLLBACK')
  throw e
}

const linked = db.query('SELECT COUNT(*) c FROM Employment WHERE departmentId IS NOT NULL').get().c
const empty = db.query("SELECT COUNT(*) c FROM Employment WHERE department = ''").get().c
const departments = db.query('SELECT COUNT(*) c FROM Department').get().c
console.log(`employments: ${total}, linked to a department: ${linked} (were linked before: ${linkedBefore})`)
console.log(`empty department text (left without department): ${empty}`)
console.log(`departments in dictionary: ${departments}`)
db.close()
