// @ts-nocheck — dev-only deployment tool.
/**
 * Switches the Prisma datasource provider in prisma/schema.prisma between
 * SQLite and PostgreSQL (the provider cannot be set via env — Prisma bakes
 * it into the generated client).
 *
 * Usage:
 *   bun scripts/use-db.ts sqlite|postgres
 *
 * After switching run:
 *   bun run db:generate && bun run db:push
 * (data is NOT migrated between DBMS — populate a fresh database with the
 * three import scripts).
 */
import { readFileSync, writeFileSync } from 'node:fs'

const target = process.argv[2]
if (target !== 'sqlite' && target !== 'postgres') {
  console.error('Usage: bun scripts/use-db.ts sqlite|postgres')
  process.exit(1)
}

const schemaPath = 'prisma/schema.prisma'
let schema = readFileSync(schemaPath, 'utf-8')
const re = /(datasource db \{[\s\S]*?provider\s*=\s*")(\w+)(")/
if (!re.test(schema)) {
  console.error('Could not find datasource provider in prisma/schema.prisma')
  process.exit(1)
}
const current = schema.match(re)[2]
if (current === target) {
  console.log(`Provider is already "${target}" — nothing to change.`)
} else {
  schema = schema.replace(re, `$1${target === 'postgres' ? 'postgresql' : target}$3`)
  writeFileSync(schemaPath, schema)
  console.log(`Provider switched: ${current} → ${target === 'postgres' ? 'postgresql' : target}`)
}

const url = target === 'postgres'
  ? 'postgresql://user:password@host:5432/analytics?schema=public'
  : 'file:./db/custom.db'
console.log(`\nNext steps:`)
console.log(`  1. Set DATABASE_URL in .env, e.g.:  DATABASE_URL=${url}`)
console.log(`  2. bun run db:generate`)
console.log(`  3. bun run db:push`)
console.log(`  4. Populate: import-schedules.ts, import-staff.ts, import-employees.ts`)
