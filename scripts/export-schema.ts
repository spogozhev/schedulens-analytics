// @ts-nocheck — dev-only tool.
/**
 * Exports the live database structure with an ER diagram to db_schema.md.
 *
 * Supports both deployment dialects (see src/lib/sql-dialect.ts):
 *   - SQLite: sqlite_master + PRAGMA table_info / foreign_key_list / index_list
 *   - PostgreSQL: information_schema / pg_catalog
 *
 * Usage:
 *   DATABASE_URL="file:<abs path to db>" bun scripts/export-schema.ts [output.md]
 */
import { writeFileSync } from 'node:fs'
import { db } from '../src/lib/db'
import { isPostgres } from '../src/lib/sql-dialect'

const outPath = process.argv[2] ?? 'db_schema.md'

interface Column {
  name: string
  type: string
  notnull: boolean
  dflt: string | null
  pk: boolean
}
interface Fk {
  from: string
  table: string
  to: string
}
interface IndexInfo {
  name: string
  unique: boolean
  columns: string[]
}
interface TableInfo {
  name: string
  columns: Column[]
  indexes: IndexInfo[]
  fks: Fk[]
  rowCount: number
}

const ident = (name: string) => `"${name.replace(/"/g, '""')}"`
const q = async (sql: string, params: (string | number)[] = []) =>
  db.$queryRawUnsafe(sql, ...params)

async function sqliteTables(): Promise<TableInfo[]> {
  const names = (
    (await q(
      `SELECT name FROM sqlite_master
        WHERE type = 'table'
          AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\'
          AND name NOT LIKE '\_prisma_%'
        ORDER BY name`,
    )) as Array<{ name: string }>
  ).map((r) => r.name)

  const tables: TableInfo[] = []
  for (const name of names) {
    const safe = name.replace(/'/g, "''")
    const columns: Column[] = (
      (await q(`PRAGMA table_info('${safe}')`)) as Array<any>
    ).map((c) => ({
      name: c.name,
      type: c.type || 'TEXT',
      notnull: !!c.notnull,
      dflt: c.dflt_value ?? null,
      pk: c.pk > 0,
    }))
    const indexes: IndexInfo[] = (
      (await q(`PRAGMA index_list('${safe}')`)) as Array<any>
    )
      .filter((i) => i.origin === 'c')
      .map((i) => ({ name: i.name, unique: !!i.unique, columns: [] as string[] }))
    // index_info must be awaited per index — do it in a loop (small counts).
    for (const idx of indexes) {
      idx.columns = (
        (await q(`PRAGMA index_info('${idx.name.replace(/'/g, "''")}')`)) as Array<any>
      ).map((c) => c.name)
    }
    const fks: Fk[] = (
      (await q(`PRAGMA foreign_key_list('${safe}')`)) as Array<any>
    ).map((f) => ({ from: f.from, table: f.table, to: f.to ?? 'id' }))
    const rowCount = Number(
      ((await q(`SELECT COUNT(*) AS c FROM ${ident(name)}`)) as Array<any>)[0].c,
    )
    tables.push({ name, columns, indexes, fks, rowCount })
  }
  return tables
}

async function pgTables(): Promise<TableInfo[]> {
  const names = (
    (await q(
      `SELECT tablename AS name FROM pg_tables
        WHERE schemaname = 'public' AND tablename NOT LIKE '\_prisma%' ESCAPE '\'
        ORDER BY 1`,
    )) as Array<{ name: string }>
  ).map((r) => r.name)

  const tables: TableInfo[] = []
  for (const name of names) {
    const columns: Column[] = (
      (await q(
        `SELECT column_name, data_type, is_nullable, column_default
           FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = $1
          ORDER BY ordinal_position`,
        [name],
      )) as Array<any>
    ).map((c) => ({
      name: c.column_name,
      type: String(c.data_type).toUpperCase(),
      notnull: c.is_nullable === 'NO',
      dflt: c.column_default ?? null,
      pk: false, // filled below
    }))
    const pkCols = new Set(
      (
        (await q(
          `SELECT a.attname AS name
             FROM pg_index i
             JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
            WHERE i.indrelid = '${name.replace(/'/g, "''")}'::regclass AND i.indisprimary`,
        )) as Array<any>
      ).map((r) => r.name),
    )
    for (const c of columns) c.pk = pkCols.has(c.name)

    const fks: Fk[] = (
      (await q(
        `SELECT kcu.column_name AS from_col,
                ccu.table_name  AS ref_table,
                ccu.column_name AS ref_col
           FROM information_schema.table_constraints tc
           JOIN information_schema.key_column_usage kcu
             ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
           JOIN information_schema.constraint_column_usage ccu
             ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
          WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public' AND tc.table_name = $1`,
        [name],
      )) as Array<any>
    ).map((f) => ({ from: f.from_col, table: f.ref_table, to: f.ref_col }))

    const indexes: IndexInfo[] = (
      (await q(
        `SELECT indexname AS name, indexdef AS def
           FROM pg_indexes
          WHERE schemaname = 'public' AND tablename = $1
            AND indexname NOT LIKE '%_pkey'`,
        [name],
      )) as Array<any>
    ).map((i) => ({
      name: i.name,
      unique: String(i.def).toUpperCase().startsWith('CREATE UNIQUE'),
      columns: [],
    }))
    // Column list per index: pg_attribute via the index relation.
    for (const idx of indexes) {
      idx.columns = (
        (await q(
          `SELECT a.attname AS name
             FROM pg_index i
             JOIN pg_attribute a ON a.attrelid = i.indexrelid AND a.attnum = ANY(i.indkey)
            WHERE i.indexrelid = '${idx.name.replace(/'/g, "''")}'::regclass
            ORDER BY a.attnum`,
        )) as Array<any>
      ).map((r) => r.name)
    }

    const rowCount = Number(
      ((await q(`SELECT COUNT(*) AS c FROM ${ident(name)}`)) as Array<any>)[0].c,
    )
    tables.push({ name, columns, indexes, fks, rowCount })
  }
  return tables
}

async function main(): Promise<void> {
  await db.$queryRawUnsafe('SELECT 1') // ensure connected
  const tables = isPostgres ? await pgTables() : await sqliteTables()
  const dbLabel = isPostgres ? 'PostgreSQL' : 'SQLite'

  // ---------- ordering: referenced (parent) tables first, then alphabetical ----------
  const parentOf = new Map<string, Set<string>>()
  for (const t of tables) parentOf.set(t.name, new Set(t.fks.map((f) => f.table)))
  const byName = new Map(tables.map((t) => [t.name, t]))
  const ordered: string[] = []
  const visited = new Set<string>()
  const visit = (name: string, stack: Set<string>) => {
    if (visited.has(name) || stack.has(name)) return
    stack.add(name)
    for (const p of [...(parentOf.get(name) ?? [])].sort()) visit(p, stack)
    stack.delete(name)
    visited.add(name)
    if (byName.has(name)) ordered.push(name)
  }
  for (const t of tables.map((t) => t.name).sort()) visit(t, new Set())
  const orderedTables = ordered.map((n) => byName.get(n))

  // ---------- markdown ----------
  const fmtInt = (n: number) => new Intl.NumberFormat('ru-RU').format(n)
  const keyLabel = (t: TableInfo, col: Column): string => {
    const parts: string[] = []
    if (col.pk) parts.push('PK')
    if (t.fks.some((f) => f.from === col.name)) parts.push('FK')
    if (
      t.indexes.some(
        (i) => i.unique && i.columns.length === 1 && i.columns[0] === col.name,
      )
    )
      parts.push('UNIQUE')
    return parts.join(', ')
  }

  const lines: string[] = []
  lines.push('# Схема базы данных')
  lines.push('')
  lines.push(
    `_Сгенерировано \`${new Date().toISOString()}\` (${dbLabel}) скриптом \`bun run db:schema\`._`,
  )
  lines.push('')
  lines.push(`Таблиц: **${tables.length}**. Строк всего: **${fmtInt(tables.reduce((s, t) => s + t.rowCount, 0))}**.`)
  lines.push('')

  lines.push('## ER-диаграмма')
  lines.push('')
  lines.push('```mermaid')
  lines.push('erDiagram')
  for (const t of orderedTables) {
    lines.push(`  ${t.name} {`)
    for (const c of t.columns) {
      const type = (c.type || 'TEXT').toUpperCase().replace(/\s+/g, '_')
      const key = c.pk ? ' PK' : t.fks.some((f) => f.from === c.name) ? ' FK' : ''
      lines.push(`    ${type} ${c.name}${key}`)
    }
    lines.push('  }')
  }
  lines.push('')
  const rels: string[] = []
  for (const t of orderedTables) {
    for (const f of t.fks) rels.push(`  ${f.table} ||--o{ ${t.name} : "${f.from}"`)
  }
  lines.push(...rels.sort())
  lines.push('```')
  lines.push('')
  lines.push('Обозначения: `PK` — первичный ключ, `FK` — внешний ключ. Связь `A ||--o{ B` — «один A → много B».')
  lines.push('')

  lines.push('## Таблицы')
  lines.push('')
  for (const t of orderedTables) {
    lines.push(`### ${t.name}`)
    lines.push('')
    lines.push(`Строк: **${fmtInt(t.rowCount)}**.`)
    lines.push('')
    lines.push('| Колонка | Тип | NULL | По умолчанию | Ключ |')
    lines.push('|---|---|---|---|---|')
    for (const c of t.columns) {
      const nullable = c.notnull ? 'NO' : 'YES'
      const dflt = c.dflt === null ? '—' : `\`${c.dflt}\``
      lines.push(`| \`${c.name}\` | ${c.type || 'TEXT'} | ${nullable} | ${dflt} | ${keyLabel(t, c) || '—'} |`)
    }
    lines.push('')

    if (t.indexes.length > 0) {
      lines.push('**Индексы:**')
      lines.push('')
      for (const i of t.indexes) {
        const uniq = i.unique ? ' (UNIQUE)' : ''
        lines.push(`- \`${i.name}\`${uniq} → \`${i.columns.join(', ')}\``)
      }
      lines.push('')
    }
    if (t.fks.length > 0) {
      lines.push('**Внешние ключи:**')
      lines.push('')
      for (const f of t.fks) {
        lines.push(`- \`${f.from}\` → \`${f.table}.${f.to}\``)
      }
      lines.push('')
    }
  }

  writeFileSync(outPath, lines.join('\n'), 'utf8')
  console.log(`exported ${tables.length} tables (${dbLabel}) to ${outPath}`)
  await db.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
