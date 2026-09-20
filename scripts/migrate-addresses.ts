// @ts-nocheck — dev-only migration script; bun:sqlite types are not installed.
/**
 * One-time data migration: parses Location.displayName into addresses and
 * fills the Address table + Location.addressId.
 *
 * Idempotent: re-running only fills missing values. Run `prisma db push`
 * first so Address / Location.addressId exist.
 *
 * Usage:
 *   DATABASE_URL="file:<abs path to db>" bun scripts/migrate-addresses.ts
 */
import { Database } from 'bun:sqlite'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseLocationAddress } from './address-parse'

function resolveDbPath(url: string): string {
  const p = url.replace(/^file:/, '').split('?')[0]
  if (existsSync(p)) return p
  const viaPrisma = resolve(process.cwd(), 'prisma', p)
  if (existsSync(viaPrisma)) return viaPrisma
  return p
}
const db = new Database(resolveDbPath(process.env.DATABASE_URL ?? 'file:./db/custom.db'))
db.exec('PRAGMA journal_mode = WAL')

const total = db.query('SELECT COUNT(*) c FROM Location').get().c
const linkedBefore = db.query('SELECT COUNT(*) c FROM Location WHERE addressId IS NOT NULL').get().c

db.exec('BEGIN')
try {
  const insAddress = db.prepare('INSERT INTO Address (displayName) VALUES (?) ON CONFLICT(displayName) DO NOTHING')
  const setId = db.prepare('UPDATE Location SET addressId = (SELECT id FROM Address WHERE displayName = ?) WHERE id = ?')
  const rows = db.query('SELECT id, displayName FROM Location').all()
  let linked = 0
  const unparsed = []
  for (const r of rows) {
    const parsed = parseLocationAddress(r.displayName)
    if (!parsed) { unparsed.push(r.displayName); continue }
    insAddress.run(parsed.address)
    setId.run(parsed.address, r.id)
    linked++
  }
  db.exec('COMMIT')
  console.log(`locations: ${total}, linked to an address: ${linked} (were linked before: ${linkedBefore}), unparsed: ${unparsed.length}`)
  for (const u of unparsed) console.log(`  unparsed: ${u}`)
  const addrCount = db.query('SELECT COUNT(*) c FROM Address').get().c
  console.log(`addresses in dictionary: ${addrCount}`)
  const top = db
    .query(`
      SELECT a.displayName AS name, COUNT(l.id) AS rooms
        FROM Address a JOIN Location l ON l.addressId = a.id
       GROUP BY a.id ORDER BY rooms DESC LIMIT 5
    `)
    .all()
  for (const r of top) console.log(`  ${String(r.rooms).padStart(4)} | ${r.name}`)
} catch (e) {
  db.exec('ROLLBACK')
  throw e
}
db.close()
