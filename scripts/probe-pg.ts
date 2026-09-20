// @ts-nocheck
import { db } from '../src/lib/db'
const name = 'Address'
const steps: Array<[string, string]> = [
  ['columns', `SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = '${name}' ORDER BY ordinal_position`],
  ['pk', `SELECT a.attname AS name FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey) WHERE i.indrelid = '${name}'::regclass AND i.indisprimary`],
  ['indexes', `SELECT indexname AS name, indexdef AS def FROM pg_indexes WHERE schemaname = 'public' AND tablename = '${name}' AND indexname NOT LIKE '%_pkey'`],
  ['idxcols', `SELECT a.attname AS name FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indexrelid AND a.attnum = ANY(i.indkey) WHERE i.indexrelid = '${name}_displayName_key'::regclass`],
  ['count', `SELECT COUNT(*) AS c FROM "${name}"`],
]
for (const [label, sql] of steps) {
  try {
    const r: any[] = (await db.$queryRawUnsafe(sql)) as any[]
    console.log(label, 'OK rows=', r.length, r.length === 1 ? JSON.stringify(r[0]).slice(0, 120) : '')
  } catch (e) {
    console.log(label, 'FAIL:', String((e as Error).message).slice(0, 140))
  }
}
await db.$disconnect()
