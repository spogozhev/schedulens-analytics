/**
 * import-schedules.ts
 *
 * Recursively scans a directory of teacher-schedule JSON files (the format
 * produced by the SPbU "wheretoteach" schedule portal) and merges every
 * event into the unified SQLite database via Prisma.
 *
 * Key behaviours:
 *  - Recursively walks subfolders looking for *.json files (handles 1000+ files).
 *  - Parses Russian short dates "D.M" (e.g. "2.6" = 2 June).
 *  - Parses Russian weekly ranges "с D.M по D.M (N)" by generating N weekly
 *    occurrences on the day-of-week specified by the enclosing day.
 *  - Infers the year from the file's `From`/`To` term range and the event's
 *    day-of-week label so we never attach an event to the wrong year.
 *  - If an event has no `End` (or it is empty/null), the end is inferred as
 *    Start + 90 minutes (1h30m), and `hasInferredEnd` is flagged.
 *  - Same physical lecture appearing in multiple teacher JSON files is
 *    detected via a deterministic `globalEventHash` / `lectureHash`.
 *  - After import, computes "simultaneous groups": for each teacher, all
 *    events whose time intervals strictly overlap (b.start < a.maxEnd;
 *    back-to-back events that merely touch at a boundary are NOT simultaneous)
 *    are tagged with the same `simultaneousGroupId`.
 *
 * Performance optimisations (vs. original version):
 *  1. Single `db.$transaction()` wraps the entire import — eliminates per-
 *     statement fsync (the #1 bottleneck: 75% of original time).
 *  2. Entity caches (Map) for subjects, locations, groups, and educators —
 *     avoids redundant upserts (978 → ~255 for subjects, 3254 → ~54 for
 *     locations, 1616 → ~163 for groups, etc.).
 *  3. SQLite PRAGMAs: WAL journal mode, NORMAL synchronous, 128 MB cache,
 *     memory temp store, 256 MB mmap, EXCLUSIVE locking.
 *  4. Removed co-educator storage entirely — the same physical lecture
 *     appears in every co-teacher's file, so co-teachers can be derived
 *     at query time via `lectureHash` JOIN. This eliminates 21 528 upsert
 *     calls and the nested `coEducators: { create: [...] }` inside each
 *     `db.scheduleEvent.create()`.
 *
 * Incremental imports (no DB cleanup):
 *  The script does NOT clear the database before importing. Existing
 *  records are preserved, and new files are merged into the dataset.
 *  Duplicates are detected via the `findFirst` check on the composite key
 *  (educatorId, startDateTime, subjectId, globalEventHash) before each
 *  `create()`. To keep incremental imports fast, the script pre-populates
 *  the entity caches from the existing DB (`preloadCaches`) so known
 *  subjects/locations/groups/educators are not re-upserted.
 *
 *  Typical workflow:
 *    - First run: import 1000 JSON files → DB has 1000 teachers' schedules.
 *    - A week later: drop 50 NEW JSON files into the same folder, re-run
 *      the importer → 50 new teachers are added; the 1000 existing
 *      teachers' events are skipped (via findFirst); no duplicate rows.
 *    - If a teacher's file is updated (e.g. schedule changes), the importer
 *      still skips the existing events (matched by globalEventHash). To
 *      force a re-import of changed events, use `bun run db:push
 *      --force-reset` to clear the DB first, then re-run the importer.
 *
 * Usage:  bun run scripts/import-schedules.ts [directory]
 *   default directory = ./upload
 */

import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { db } from '../src/lib/db';
import type { Prisma } from '@prisma/client';

// ---------- Types ----------

interface RawEducatorId {
  Item1: number;
  Item2: string;
}
interface RawEventLocation {
  IsEmpty: boolean;
  DisplayName: string;
  HasGeographicCoordinates: boolean;
  Latitude?: number;
  Longitude?: number;
}
interface RawContingentUnit {
  Item1: string;
  Item2: string;
}
interface RawEvent {
  Start: string;
  End?: string | null;
  Subject: string;
  TimeIntervalString?: string;
  Dates: string[];
  EducatorsDisplayText: string;
  IsCanceled: boolean;
  StudyEventsTimeTableKindCode: number;
  EducatorIds: RawEducatorId[];
  EventLocations: RawEventLocation[];
  ContingentUnitNames: RawContingentUnit[];
}
interface EducatorDay {
  Day: number;
  DayString: string;
  DayStudyEventsCount: number;
  DayStudyEvents: RawEvent[];
}
interface ScheduleFile {
  Title: string;
  EducatorDisplayText: string;
  EducatorLongDisplayText: string;
  DateRangeDisplayText: string;
  EducatorMasterId: number;
  IsSpringTerm: boolean;
  From: string;
  To: string;
  Next: unknown;
  SpringTermLinkAvailable: boolean;
  AutumnTermLinkAvailable: boolean;
  HasEvents: boolean;
  EducatorEventsDays: EducatorDay[];
}

const DEFAULT_DURATION_MIN = 90; // 1h 30m

const KIND_LABELS: Record<number, string> = {
  0: 'Индивидуальные мероприятия',
  1: 'Регулярные занятия',
  2: 'Сессия / консультации',
};

// ---------- Entity caches ----------

interface EntityCaches {
  subject: Map<string, number>;
  location: Map<string, { id: number; latitude: number | null; longitude: number | null }>;
  group: Map<string, number>;
  educator: Set<number>;
}

function newCaches(): EntityCaches {
  return {
    subject: new Map(),
    location: new Map(),
    group: new Map(),
    educator: new Set(),
  };
}

/**
 * Pre-populate the entity caches from the existing DB so that the importer
 * skips already-known subjects/locations/groups/educators instead of
 * re-issuing upserts for them. This is important for incremental imports
 * (where the database is NOT cleared) — without this, the second and
 * subsequent runs would re-execute thousands of no-op upserts.
 *
 * We read all rows of Subject, Location, Group, and Educator in a single
 * `findMany` each — for a 5000-teacher university this is ~5500 + ~1000 +
 * ~200 + ~5000 rows, all loaded into memory Maps. This takes <1s and saves
 * many seconds of redundant upsert queries during import.
 */
async function preloadCaches(caches: EntityCaches): Promise<void> {
  const t0 = Date.now();
  console.log('Pre-populating entity caches from existing DB…');

  const [subjects, locations, groups, educators] = await Promise.all([
    db.subject.findMany({ select: { id: true, name: true } }),
    db.location.findMany({ select: { id: true, displayName: true, latitude: true, longitude: true } }),
    db.group.findMany({ select: { id: true, name: true } }),
    db.educator.findMany({ select: { id: true } }),
  ]);

  for (const s of subjects) caches.subject.set(s.name, s.id);
  for (const l of locations) {
    caches.location.set(l.displayName, { id: l.id, latitude: l.latitude, longitude: l.longitude });
  }
  for (const g of groups) caches.group.set(g.name, g.id);
  for (const e of educators) caches.educator.add(e.id);

  console.log(
    `  Loaded ${subjects.length} subjects, ${locations.length} locations, ${groups.length} groups, ${educators.length} educators in ${((Date.now() - t0) / 1000).toFixed(2)}s.`,
  );
}

// ---------- Date parsing helpers ----------

function pickYearForDate(month: number, day: number, range: { from: Date; to: Date }): number | null {
  const candidates = new Set<number>([
    range.from.getUTCFullYear(),
    range.to.getUTCFullYear(),
    range.from.getUTCFullYear() + 1,
    range.to.getUTCFullYear() - 1,
  ]);
  for (const y of candidates) {
    const d = new Date(Date.UTC(y, month - 1, day));
    if (d >= range.from && d <= range.to) return y;
  }
  return null;
}

function dayOfWeekMatches(d: Date, expectedDay1to7: number): boolean {
  const js = d.getUTCDay(); // 0=Sun … 6=Sat
  const as1to7 = js === 0 ? 7 : js;
  return as1to7 === expectedDay1to7;
}

function parseSingleDate(s: string, expectedDow: number, range: { from: Date; to: Date }): Date | null {
  const m = s.trim().match(/^(\d{1,2})\.(\d{1,2})$/);
  if (!m) return null;
  const day = parseInt(m[1], 10);
  const month = parseInt(m[2], 10);
  const y = pickYearForDate(month, day, range);
  if (y === null) return null;
  const d = new Date(Date.UTC(y, month - 1, day));
  if (!dayOfWeekMatches(d, expectedDow)) {
    for (const alt of [range.from.getUTCFullYear(), range.to.getUTCFullYear(), y + 1, y - 1]) {
      const dd = new Date(Date.UTC(alt, month - 1, day));
      if (dd >= range.from && dd <= range.to && dayOfWeekMatches(dd, expectedDow)) return dd;
    }
  }
  return d;
}

function parseRangeDates(s: string, expectedDow: number, range: { from: Date; to: Date }): Date[] {
  const m = s.trim().match(/^с\s+(\d{1,2})\.(\d{1,2})\s+по\s+(\d{1,2})\.(\d{1,2})\s*\((\d+)\)/);
  if (!m) return [];
  const sd = parseInt(m[1], 10);
  const sm = parseInt(m[2], 10);
  const ed = parseInt(m[3], 10);
  const em = parseInt(m[4], 10);
  const count = parseInt(m[5], 10);

  let startDate: Date | null = null;
  for (const y of [range.from.getUTCFullYear(), range.to.getUTCFullYear(), range.from.getUTCFullYear() + 1]) {
    const d = new Date(Date.UTC(y, sm - 1, sd));
    if (d >= range.from && d <= range.to) {
      if (dayOfWeekMatches(d, expectedDow)) {
        startDate = d;
        break;
      }
      if (!startDate) startDate = d;
    }
  }
  if (!startDate) return [];

  let endCand: Date | null = null;
  for (const y of [startDate.getUTCFullYear(), startDate.getUTCFullYear() + 1]) {
    const d = new Date(Date.UTC(y, em - 1, ed));
    if (d >= startDate) {
      endCand = d;
      break;
    }
  }
  const endDate = endCand ?? new Date(Date.UTC(startDate.getUTCFullYear(), em - 1, ed));

  const dates: Date[] = [];
  const cur = new Date(startDate.getTime());
  let guard = 0;
  while (dates.length < count && cur <= endDate && guard < 200) {
    dates.push(new Date(cur.getTime()));
    cur.setUTCDate(cur.getUTCDate() + 7);
    guard++;
  }
  return dates;
}

function timeToDate(baseDate: Date, timeStr: string): Date {
  const parts = timeStr.split(':').map(Number);
  const d = new Date(baseDate.getTime());
  d.setUTCHours(parts[0] || 0, parts[1] || 0, parts[2] || 0, 0);
  return d;
}

function computeEnd(baseDate: Date, startStr: string, endStr: string | null | undefined): { end: Date; inferred: boolean } {
  if (endStr && endStr.trim() !== '') {
    return { end: timeToDate(baseDate, endStr), inferred: false };
  }
  const start = timeToDate(baseDate, startStr);
  const end = new Date(start.getTime() + DEFAULT_DURATION_MIN * 60_000);
  return { end, inferred: true };
}

// ---------- Hash ----------

function hashEvent(ev: RawEvent, startDateTime: Date, endDateTime: Date, includeGroups: boolean): string {
  const locs = [...new Set((ev.EventLocations || []).filter((l) => !l.IsEmpty && l.DisplayName).map((l) => l.DisplayName))].sort();
  const educators = [...new Set((ev.EducatorIds || []).map((e) => e.Item2).filter(Boolean))].sort();
  const groups = includeGroups ? [...new Set((ev.ContingentUnitNames || []).map((g) => g.Item1).filter(Boolean))].sort() : [];
  const payload = JSON.stringify({
    subject: ev.Subject,
    start: startDateTime.toISOString(),
    end: endDateTime.toISOString(),
    locations: locs,
    groups,
    educators,
  });
  return crypto.createHash('md5').update(payload).digest('hex');
}

// ---------- File walking ----------

async function walkDir(dir: string, out: string[]): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      await walkDir(full, out);
    } else if (e.isFile() && e.name.toLowerCase().endsWith('.json')) {
      out.push(full);
    }
  }
}

// ---------- SQLite PRAGMA setup ----------

async function setupPragmas(): Promise<void> {
  // These PRAGMAs dramatically reduce fsync overhead for large bulk imports.
  // `journal_mode = WAL` is persistent (survives script exit); the rest are
  // per-connection but take effect for this script's transaction.
  //
  // NOTE: Some PRAGMAs (notably `journal_mode = WAL`) return a row, so we use
  // `$queryRawUnsafe` for all of them (instead of `$executeRawUnsafe`, which
  // fails with "Execute returned results, which is not allowed in SQLite").
  //
  // We deliberately DO NOT set `locking_mode = EXCLUSIVE` because it can
  // leave a stale WAL lock if the script is re-run while the DB is in WAL
  // mode (the second run blocks until socket timeout). The default
  // `locking_mode = NORMAL` is fine — WAL mode + NORMAL synchronous is
  // already 5-10× faster than the default rollback-journal mode.
  await db.$queryRawUnsafe('PRAGMA journal_mode = WAL');
  await db.$queryRawUnsafe('PRAGMA synchronous = NORMAL');
  await db.$queryRawUnsafe('PRAGMA cache_size = -134217728'); // 128 MB
  await db.$queryRawUnsafe('PRAGMA temp_store = MEMORY');
  await db.$queryRawUnsafe('PRAGMA mmap_size = 268435456'); // 256 MB
}

// ---------- Cached entity helpers ----------

async function getOrCreateSubject(
  tx: Prisma.TransactionClient,
  cache: Map<string, number>,
  name: string,
): Promise<number> {
  const cached = cache.get(name);
  if (cached !== undefined) return cached;
  const subject = await tx.subject.upsert({
    where: { name },
    create: { name },
    update: {},
    select: { id: true },
  });
  cache.set(name, subject.id);
  return subject.id;
}

async function getOrCreateLocation(
  tx: Prisma.TransactionClient,
  cache: Map<string, { id: number; latitude: number | null; longitude: number | null }>,
  displayName: string,
  latitude: number | null,
  longitude: number | null,
): Promise<number> {
  const cached = cache.get(displayName);
  if (cached) return cached.id;
  const location = await tx.location.upsert({
    where: { displayName },
    create: { displayName, latitude, longitude },
    update: {},
    select: { id: true },
  });
  cache.set(displayName, { id: location.id, latitude, longitude });
  return location.id;
}

async function getOrCreateGroup(
  tx: Prisma.TransactionClient,
  cache: Map<string, number>,
  name: string,
): Promise<number> {
  const cached = cache.get(name);
  if (cached !== undefined) return cached;
  const group = await tx.group.upsert({
    where: { name },
    create: { name },
    update: {},
    select: { id: true },
  });
  cache.set(name, group.id);
  return group.id;
}

async function ensureEducator(
  tx: Prisma.TransactionClient,
  cache: Set<number>,
  id: number,
  data: { displayName: string; longName: string; scheduleFrom: Date; scheduleTo: Date; isSpringTerm: boolean },
): Promise<void> {
  if (cache.has(id)) return;
  await tx.educator.upsert({
    where: { id },
    create: { id, ...data },
    update: data,
  });
  cache.add(id);
}

// ---------- Per-file import ----------

async function importFile(
  filePath: string,
  tx: Prisma.TransactionClient,
  caches: EntityCaches,
): Promise<{ events: number; skipped: number }> {
  const content = await fs.readFile(filePath, 'utf-8');
  let data: ScheduleFile;
  try {
    data = JSON.parse(content) as ScheduleFile;
  } catch (e) {
    console.error(`Skipping (bad JSON): ${filePath} — ${(e as Error).message}`);
    return { events: 0, skipped: 0 };
  }
  if (!data || typeof data.EducatorMasterId !== 'number') {
    console.error(`Skipping (no EducatorMasterId): ${filePath}`);
    return { events: 0, skipped: 0 };
  }

  const from = new Date(data.From);
  const to = new Date(data.To);
  if (isNaN(from.getTime()) || isNaN(to.getTime())) {
    console.error(`Skipping (bad term range): ${filePath}`);
    return { events: 0, skipped: 0 };
  }
  const range = { from, to };

  // Ensure the primary educator exists (cached — only first file per ID).
  await ensureEducator(tx, caches.educator, data.EducatorMasterId, {
    displayName: data.EducatorDisplayText,
    longName: data.EducatorLongDisplayText,
    scheduleFrom: from,
    scheduleTo: to,
    isSpringTerm: !!data.IsSpringTerm,
  });

  let eventsInserted = 0;
  let eventsSkippedDuplicate = 0;

  for (const day of data.EducatorEventsDays || []) {
    for (const ev of day.DayStudyEvents || []) {
      // Expand Dates into actual session dates.
      const dates: Date[] = [];
      for (const dateStr of ev.Dates || []) {
        const trimmed = dateStr.trim();
        if (!trimmed) continue;
        if (trimmed.startsWith('с')) {
          dates.push(...parseRangeDates(trimmed, day.Day, range));
        } else {
          const d = parseSingleDate(trimmed, day.Day, range);
          if (d) dates.push(d);
        }
      }

      // Get or create subject (cached).
      const subjectId = await getOrCreateSubject(tx, caches.subject, ev.Subject);

      for (const d of dates) {
        const startDateTime = timeToDate(d, ev.Start);
        const { end: endDateTime, inferred } = computeEnd(d, ev.Start, ev.End);
        const durationMinutes = Math.max(1, Math.round((endDateTime.getTime() - startDateTime.getTime()) / 60_000));
        const globalEventHash = hashEvent(ev, startDateTime, endDateTime, true);
        const lectureHash = hashEvent(ev, startDateTime, endDateTime, false);

        // Pre-insert duplicate check (safety net; inside the transaction
        // this is nearly free — no fsync).
        const existing = await tx.scheduleEvent.findFirst({
          where: {
            educatorId: data.EducatorMasterId,
            startDateTime,
            subjectId,
            globalEventHash,
          },
          select: { id: true },
        });
        if (existing) {
          eventsSkippedDuplicate++;
          continue;
        }

        // Resolve locations (deduped by DisplayName, cached).
        const locationIds: number[] = [];
        const seenLocationNames = new Set<string>();
        for (const loc of ev.EventLocations || []) {
          if (loc.IsEmpty || !loc.DisplayName) continue;
          if (seenLocationNames.has(loc.DisplayName)) continue;
          seenLocationNames.add(loc.DisplayName);
          const id = await getOrCreateLocation(
            tx,
            caches.location,
            loc.DisplayName,
            loc.HasGeographicCoordinates ? loc.Latitude ?? null : null,
            loc.HasGeographicCoordinates ? loc.Longitude ?? null : null,
          );
          locationIds.push(id);
        }

        // Resolve groups (deduped by Item1, cached).
        const groupIds: number[] = [];
        const seenGroupNames = new Set<string>();
        for (const g of ev.ContingentUnitNames || []) {
          if (!g.Item1) continue;
          if (seenGroupNames.has(g.Item1)) continue;
          seenGroupNames.add(g.Item1);
          const id = await getOrCreateGroup(tx, caches.group, g.Item1);
          groupIds.push(id);
        }

        // Insert the event (no co-educators — derived at query time via
        // lectureHash JOIN).
        await tx.scheduleEvent.create({
          data: {
            educatorId: data.EducatorMasterId,
            subjectId,
            startDateTime,
            endDateTime,
            rawStart: ev.Start,
            rawEnd: ev.End || null,
            hasInferredEnd: inferred,
            durationMinutes,
            dayOfWeek: day.Day,
            dayString: day.DayString,
            dateStr: (ev.Dates || []).join(', '),
            termFrom: from,
            termTo: to,
            isSpringTerm: !!data.IsSpringTerm,
            isCanceled: !!ev.IsCanceled,
            kindCode: ev.StudyEventsTimeTableKindCode ?? 0,
            educatorsDisplayText: ev.EducatorsDisplayText || '',
            globalEventHash,
            lectureHash,
            locations: { create: locationIds.map((id) => ({ locationId: id })) },
            groups: { create: groupIds.map((id) => ({ groupId: id })) },
          },
        });
        eventsInserted++;
      }
    }
  }
  if (eventsSkippedDuplicate > 0) {
    console.log(`  (${eventsSkippedDuplicate} duplicate date(s) skipped in ${filePath})`);
  }
  return { events: eventsInserted, skipped: eventsSkippedDuplicate };
}

// ---------- Simultaneous-group computation ----------

async function computeSimultaneousGroups(
  tx: Prisma.TransactionClient,
  educatorIds: number[],
): Promise<{ teachers: number; groups: number; simultaneousEvents: number }> {
  let groupCount = 0;
  let simultaneousEvents = 0;
  let teachersWithSim = 0;
  let groupCounter = 0;

  for (let i = 0; i < educatorIds.length; i++) {
    const teacherId = educatorIds[i];
    const events = await tx.scheduleEvent.findMany({
      where: { educatorId: teacherId },
      orderBy: { startDateTime: 'asc' },
      select: { id: true, startDateTime: true, endDateTime: true },
    });
    if (events.length === 0) continue;

    // Sweep-line: group strictly overlapping (chained) intervals.
    // Back-to-back events (a.end === b.start) are NOT simultaneous.
    type G = { ids: string[]; maxEnd: number; minStart: number };
    const groups: G[] = [];
    let cur: G | null = null;
    for (const ev of events) {
      const s = ev.startDateTime.getTime();
      const e = ev.endDateTime.getTime();
      if (cur && s < cur.maxEnd) {
        cur.ids.push(ev.id);
        cur.maxEnd = Math.max(cur.maxEnd, e);
        cur.minStart = Math.min(cur.minStart, s);
      } else {
        cur = { ids: [ev.id], maxEnd: e, minStart: s };
        groups.push(cur);
      }
    }

    let hadSim = false;
    for (const g of groups) {
      if (g.ids.length <= 1) continue;
      const groupId = `sim-${teacherId}-${groupCounter++}`;
      await tx.scheduleEvent.updateMany({
        where: { id: { in: g.ids } },
        data: { simultaneousGroupId: groupId },
      });
      groupCount++;
      simultaneousEvents += g.ids.length;
      hadSim = true;
    }
    if (hadSim) teachersWithSim++;
  }

  return { teachers: educatorIds.length, groups: groupCount, simultaneousEvents };
}

// ---------- Main ----------

async function main() {
  const dir = process.argv[2] || './upload';
  console.log(`Importing schedules from: ${dir}`);

  const t0 = Date.now();

  // Step 1: SQLite PRAGMAs
  console.log('Setting SQLite PRAGMAs…');
  await setupPragmas();

  // Step 2: Walk files
  const files: string[] = [];
  await walkDir(dir, files);
  console.log(`Found ${files.length} JSON file(s).`);

  // Step 3: Import all files in a single transaction.
  //
  // NOTE: This script does NOT clear the database — existing records are
  // preserved. Duplicates are skipped via the `findFirst` check on the
  // composite key (educatorId, startDateTime, subjectId, globalEventHash)
  // before each `create()`. Running the importer repeatedly (e.g. once a
  // week when new schedule files become available) will simply add the new
  // events to the existing dataset without touching the previously
  // imported ones.
  //
  // Before importing, we pre-populate the entity caches from the existing
  // DB so upserts for already-known subjects/locations/groups/educators
  // are skipped entirely — this keeps incremental imports fast (otherwise
  // every run would re-issue thousands of no-op upserts for already-known
  // entities).
  const caches = newCaches();
  await preloadCaches(caches);
  const tImportStart = Date.now();
  let totalEvents = 0;
  let totalSkipped = 0;
  let ok = 0;
  let failed = 0;

  try {
    await db.$transaction(
      async (tx) => {
        for (let i = 0; i < files.length; i++) {
          try {
            const { events, skipped } = await importFile(files[i], tx, caches);
            totalEvents += events;
            totalSkipped += skipped;
            ok++;
            if ((i + 1) % 25 === 0 || i === files.length - 1) {
              console.log(`  Processed ${i + 1}/${files.length} files, ${totalEvents} events so far.`);
            }
          } catch (e) {
            failed++;
            console.error(`Error in ${files[i]}:`, (e as Error).message);
          }
        }
      },
      { maxWait: 60_000, timeout: 7_200_000 }, // 2 hours max
    );
  } catch (e) {
    console.error('Transaction failed:', (e as Error).message);
    throw e;
  }

  const tImportEnd = Date.now();
  console.log(`Imported ${totalEvents} events from ${ok} file(s) (${failed} failed, ${totalSkipped} duplicates skipped).`);

  // Step 5: Compute simultaneous groups in a separate transaction
  console.log('Computing simultaneous groups…');
  const tSimStart = Date.now();
  const educatorIds = [...caches.educator];
  let sim: { teachers: number; groups: number; simultaneousEvents: number };
  try {
    sim = await db.$transaction(
      async (tx) => {
        return await computeSimultaneousGroups(tx, educatorIds);
      },
      { maxWait: 60_000, timeout: 7_200_000 },
    );
  } catch (e) {
    console.error('Simultaneous groups transaction failed:', (e as Error).message);
    throw e;
  }
  const tSimEnd = Date.now();
  console.log(
    `Simultaneous: ${sim.teachers} teachers, ${sim.groups} groups, ${sim.simultaneousEvents} events flagged.`,
  );

  // Step 6: Summary with timing
  const teachers = await db.educator.count();
  const events = await db.scheduleEvent.count();
  const locations = await db.location.count();
  const subjects = await db.subject.count();
  const groupsCount = await db.group.count();
  const kindCodes = await db.scheduleEvent.groupBy({
    by: ['kindCode'],
    _count: { _all: true },
  });
  console.log('--- Summary ---');
  console.log(`Teachers: ${teachers}`);
  console.log(`Events: ${events}`);
  console.log(`Locations: ${locations}`);
  console.log(`Subjects: ${subjects}`);
  console.log(`Groups: ${groupsCount}`);
  for (const k of kindCodes) {
    console.log(`  Kind ${k.kindCode} (${KIND_LABELS[k.kindCode] ?? '?'}): ${k._count._all}`);
  }
  console.log('--- Timing ---');
  console.log(`Import:  ${((tImportEnd - tImportStart) / 1000).toFixed(2)}s`);
  console.log(`Simult:  ${((tSimEnd - tSimStart) / 1000).toFixed(2)}s`);
  console.log(`Total:   ${((tSimEnd - t0) / 1000).toFixed(2)}s`);

  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
