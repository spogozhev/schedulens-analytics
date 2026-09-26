/**
 * Imports HR information about educators from upload/staff/*.json.
 *
 * Each file covers one last-name letter: { EducatorLastNameQuery, Educators:
 * [{ Id, DisplayName, FullName, Employments: [{ Position, Department }] }] }.
 *
 * For every educator THAT HAS SCHEDULE EVENTS (see below):
 *   - the Educator row is upserted (Id = EducatorMasterId = Educator.id,
 *     DisplayName / FullName → displayName / longName);
 *   - Employments replace the educator's previous rows wholesale (the staff
 *     export is authoritative), deduplicated by (position, department).
 *
 * Only educators with at least one ScheduleEvent row are imported: the full
 * HR roster contains many people who no longer teach, and event-less
 * educators never show up in analytics. Run import-schedules.ts FIRST —
 * otherwise there are no known event educators and the script aborts.
 * (Event-less educators created by earlier runs can be removed once with
 * scripts/prune-educators.ts.)
 *
 * Idempotent: re-running produces no changes when the source is unchanged.
 *
 * Usage:
 *   DATABASE_URL="file:<abs path to db>" bun scripts/import-staff.ts [directory]
 *   default directory = ./upload/staff
 */
import fs from 'fs/promises'
import path from 'path'
import { db } from '../src/lib/db'
import { isSqlite } from '../src/lib/sql-dialect'
import { invalidateServerCache } from './invalidate-cache'
import type { Prisma } from '@prisma/client'

interface RawEmployment {
  Position: string
  Department: string
}

interface RawStaffEducator {
  Id: number
  DisplayName: string
  FullName: string
  Employments: RawEmployment[]
}

interface StaffFile {
  EducatorLastNameQuery: string
  Educators: RawStaffEducator[]
}

async function walkDir(dir: string, out: string[]): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  for (const e of entries) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) await walkDir(full, out)
    else if (e.isFile() && e.name.toLowerCase().endsWith('.json')) out.push(full)
  }
}

async function setupPragmas(): Promise<void> {
  if (!isSqlite) return // PostgreSQL needs no client-side tuning
  await db.$queryRawUnsafe('PRAGMA journal_mode = WAL')
  await db.$queryRawUnsafe('PRAGMA synchronous = NORMAL')
  await db.$queryRawUnsafe('PRAGMA cache_size = -134217728') // 128 MB
  await db.$queryRawUnsafe('PRAGMA temp_store = MEMORY')
}

async function main(): Promise<void> {
  const dir = process.argv[2] || './upload/staff'
  const files: string[] = []
  await walkDir(dir, files)
  if (files.length === 0) {
    console.error(`No .json files found in ${dir}`)
    process.exit(1)
  }
  console.log(`Found ${files.length} staff file(s) in ${dir}`)

  await setupPragmas()

  // Only import staff records for educators that teach (have events).
  // DISTINCT educatorId walks the (educatorId, startDateTime) index.
  const eventEducatorIds = new Set(
    (await db.scheduleEvent.groupBy({ by: ['educatorId'] })).map((r) => r.educatorId),
  )
  if (eventEducatorIds.size === 0) {
    console.error(
      'No schedule events in the database — the staff import would skip every record.\n' +
        'Run scripts/import-schedules.ts first, then re-run import-staff.',
    )
    process.exit(1)
  }
  console.log(
    `Educators with schedule events: ${eventEducatorIds.size} (other staff records will be skipped).`,
  )

  let educatorsCreated = 0
  let educatorsUpdated = 0
  let employmentsTotal = 0
  let staffWithoutEmployments = 0
  let skippedNoEvents = 0
  let skipped = 0
  let failedFiles = 0
  const departmentCache = new Map<string, number>()

  // Resolves (or creates) the Department dictionary row for a department name.
  const getOrCreateDepartment = async (
    tx: Prisma.TransactionClient,
    name: string,
  ): Promise<number> => {
    const cached = departmentCache.get(name)
    if (cached !== undefined) return cached
    const row = await tx.department.upsert({
      where: { name },
      create: { name },
      update: {},
      select: { id: true },
    })
    departmentCache.set(name, row.id)
    return row.id
  }

  const t0 = Date.now()
  try {
    await db.$transaction(
      async (tx) => {
        for (let i = 0; i < files.length; i++) {
          try {
            const content = await fs.readFile(files[i], 'utf-8')
            let data: StaffFile
            try {
              data = JSON.parse(content) as StaffFile
            } catch {
              console.error(`Skipping (bad JSON): ${files[i]}`)
              skipped++
              continue
            }
            const educators = data.Educators || []
            for (const e of educators) {
              if (typeof e.Id !== 'number') {
                skipped++
                continue
              }
              // The person does not teach (no events) — not our audience.
              if (!eventEducatorIds.has(e.Id)) {
                skippedNoEvents++
                continue
              }
              const existing = await tx.educator.findUnique({ where: { id: e.Id }, select: { id: true } })
              const dataPayload = { displayName: e.DisplayName || '', longName: e.FullName || '' }
              if (existing) {
                await tx.educator.update({ where: { id: e.Id }, data: dataPayload })
                educatorsUpdated++
              } else {
                await tx.educator.create({ data: { id: e.Id, ...dataPayload } })
                educatorsCreated++
              }

              // The export is authoritative: replace the educator's
              // employments with the (deduplicated) file contents.
              // Department names resolve to the Department dictionary.
              const employments = (e.Employments || [])
                .map((em) => ({
                  position: (em.Position || '').trim(),
                  department: (em.Department || '').trim(),
                }))
                .filter((em) => em.position !== '' || em.department !== '')
              const seen = new Set<string>()
              const rows: { educatorId: number; position: string; departmentId: number | null }[] = []
              for (const em of employments) {
                const key = `${em.position}||${em.department}`
                if (seen.has(key)) continue
                seen.add(key)
                rows.push({
                  educatorId: e.Id,
                  position: em.position,
                  departmentId: em.department !== '' ? await getOrCreateDepartment(tx, em.department) : null,
                })
              }
              if (employments.length === 0) staffWithoutEmployments++
              await tx.employment.deleteMany({ where: { educatorId: e.Id } })
              if (rows.length > 0) {
                await tx.employment.createMany({ data: rows })
                employmentsTotal += rows.length
              }
            }
            if ((i + 1) % 7 === 0 || i === files.length - 1) {
              console.log(`  Processed ${i + 1}/${files.length} files…`)
            }
          } catch (e) {
            failedFiles++
            console.error(`Error in ${files[i]}:`, (e as Error).message)
          }
        }
      },
      { maxWait: 60_000, timeout: 7_200_000 },
    )
  } catch (e) {
    console.error('Transaction failed:', (e as Error).message)
    throw e
  }

  const educatorsTotal = await db.educator.count()
  const withEmployments = await db.employment.groupBy({ by: ['educatorId'], _count: { _all: true } })
  console.log('--- Summary ---')
  console.log(
    `Educators: created ${educatorsCreated}, updated ${educatorsUpdated} ` +
      `(skipped: ${skippedNoEvents} without schedule events, ${skipped} bad records, ${failedFiles} failed files).`,
  )
  console.log(`Employments written: ${employmentsTotal}; educators without employments: ${staffWithoutEmployments}.`)
  console.log(
    `Educator table now: ${educatorsTotal} rows, ${withEmployments.length} with employments. Time: ${((Date.now() - t0) / 1000).toFixed(1)}s.`,
  )

  // Educator names/departments feed the analytics cache — drop it.
  await invalidateServerCache();
}

main()
  .then(() => db.$disconnect())
  .catch((e) => {
    console.error(e)
    return db.$disconnect().then(() => process.exit(1))
  })
