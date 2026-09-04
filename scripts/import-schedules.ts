/**
 * import-schedules.ts
 *
 * Recursively scans a directory of teacher-schedule JSON files (the format
 * produced by the SPbU " wheretoteach" schedule portal) and merges every
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
 *    detected via a deterministic `globalEventHash` so downstream analytics
 *    can dedupe room utilization.
 *  - After import, computes "simultaneous groups": for each teacher, all
 *    events whose time intervals overlap (chained) are tagged with the same
 *    `simultaneousGroupId`. Such overlapping events mean the teacher is in
 *    fact delivering multiple scheduled classes at the same moment and the
 *    dashboard counts that time only once.
 *
 * Usage:  bun run scripts/import-schedules.ts [directory]
 *   default directory = ./upload
 */

import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { db } from '../src/lib/db';

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
  EducatorsDisplayText?: string;
  HasEducators?: boolean;
  EducatorIds?: RawEducatorId[];
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

// ---------- Date parsing helpers ----------

function pickYearForDate(month: number, day: number, range: { from: Date; to: Date }): number | null {
  // Try the years around the term range; pick the first one whose date falls inside [from,to].
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
  // expectedDay1to7: 1=Mon … 7=Sun
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
  // Sanity check: if the day-of-week doesn't match the label, try alternate years
  if (!dayOfWeekMatches(d, expectedDow)) {
    for (const alt of [range.from.getUTCFullYear(), range.to.getUTCFullYear(), y + 1, y - 1]) {
      const dd = new Date(Date.UTC(alt, month - 1, day));
      if (dd >= range.from && dd <= range.to && dayOfWeekMatches(dd, expectedDow)) return dd;
    }
  }
  return d;
}

function parseRangeDates(s: string, expectedDow: number, range: { from: Date; to: Date }): Date[] {
  // "с D.M по D.M (N)" — N weekly occurrences on the day-of-week `expectedDow`.
  const m = s.trim().match(/^с\s+(\d{1,2})\.(\d{1,2})\s+по\s+(\d{1,2})\.(\d{1,2})\s*\((\d+)\)/);
  if (!m) return [];
  const sd = parseInt(m[1], 10);
  const sm = parseInt(m[2], 10);
  const ed = parseInt(m[3], 10);
  const em = parseInt(m[4], 10);
  const count = parseInt(m[5], 10);

  // Determine start year from term range. Prefer the year where the date also matches the DOW.
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

  // Determine end year (after start).
  let endDate: Date;
  let endYear = startDate.getUTCFullYear();
  let endCand: Date | null = null;
  for (const y of [endYear, endYear + 1]) {
    const d = new Date(Date.UTC(y, em - 1, ed));
    if (d >= startDate) {
      endCand = d;
      break;
    }
  }
  endDate = endCand ?? new Date(Date.UTC(endYear, em - 1, ed));

  // Generate weekly occurrences. Stop when count reached or end passed.
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

// ---------- Per-file import ----------

async function importFile(filePath: string): Promise<number> {
  const content = await fs.readFile(filePath, 'utf-8');
  let data: ScheduleFile;
  try {
    data = JSON.parse(content) as ScheduleFile;
  } catch (e) {
    console.error(`Skipping (bad JSON): ${filePath} — ${(e as Error).message}`);
    return 0;
  }
  if (!data || typeof data.EducatorMasterId !== 'number') {
    console.error(`Skipping (no EducatorMasterId): ${filePath}`);
    return 0;
  }

  const from = new Date(data.From);
  const to = new Date(data.To);
  if (isNaN(from.getTime()) || isNaN(to.getTime())) {
    console.error(`Skipping (bad term range): ${filePath}`);
    return 0;
  }
  const range = { from, to };

  await db.educator.upsert({
    where: { id: data.EducatorMasterId },
    create: {
      id: data.EducatorMasterId,
      displayName: data.EducatorDisplayText,
      longName: data.EducatorLongDisplayText,
      scheduleFrom: from,
      scheduleTo: to,
      isSpringTerm: !!data.IsSpringTerm,
    },
    update: {
      displayName: data.EducatorDisplayText,
      longName: data.EducatorLongDisplayText,
      scheduleFrom: from,
      scheduleTo: to,
      isSpringTerm: !!data.IsSpringTerm,
    },
  });

  // We also collect co-educator display texts (with id=-1 in the source) and
  // give them synthetic ids so we can store the relation. We use negative ids
  // starting at -100_000_000 to avoid collisions with real master ids.
  const coEducatorIdMap = new Map<string, number>();
  function getCoEducatorId(displayText: string): number {
    if (coEducatorIdMap.has(displayText)) return coEducatorIdMap.get(displayText)!;
    const syntheticId = -(100_000_000 + coEducatorIdMap.size + 1);
    coEducatorIdMap.set(displayText, syntheticId);
    return syntheticId;
  }

  let eventsInserted = 0;
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

      // Upsert subject once.
      const subject = await db.subject.upsert({
        where: { name: ev.Subject },
        create: { name: ev.Subject },
        update: {},
      });

      for (const d of dates) {
        const startDateTime = timeToDate(d, ev.Start);
        const { end: endDateTime, inferred } = computeEnd(d, ev.Start, ev.End);
        const durationMinutes = Math.max(1, Math.round((endDateTime.getTime() - startDateTime.getTime()) / 60_000));
        const globalEventHash = hashEvent(ev, startDateTime, endDateTime, true);
        const lectureHash = hashEvent(ev, startDateTime, endDateTime, false);

        // Ensure locations exist.
        const locationIds: number[] = [];
        for (const loc of ev.EventLocations || []) {
          if (loc.IsEmpty || !loc.DisplayName) continue;
          const location = await db.location.upsert({
            where: { displayName: loc.DisplayName },
            create: {
              displayName: loc.DisplayName,
              latitude: loc.HasGeographicCoordinates ? loc.Latitude ?? null : null,
              longitude: loc.HasGeographicCoordinates ? loc.Longitude ?? null : null,
            },
            update: {},
          });
          locationIds.push(location.id);
        }

        // Ensure groups exist.
        const groupIds: number[] = [];
        for (const g of ev.ContingentUnitNames || []) {
          if (!g.Item1) continue;
          const group = await db.group.upsert({
            where: { name: g.Item1 },
            create: { name: g.Item1 },
            update: {},
          });
          groupIds.push(group.id);
        }

        // Ensure co-educators (with synthetic ids) exist as Educator rows.
        const coEducatorIds: number[] = [];
        for (const ce of ev.EducatorIds || []) {
          if (!ce.Item2) continue;
          // Skip the primary educator (same display text as the file's owner) — that link is the row's own educatorId.
          if (ce.Item2 === data.EducatorDisplayText) continue;
          const synthId = getCoEducatorId(ce.Item2);
          await db.educator.upsert({
            where: { id: synthId },
            create: {
              id: synthId,
              displayName: ce.Item2.split(',')[0],
              longName: ce.Item2,
              scheduleFrom: from,
              scheduleTo: to,
              isSpringTerm: !!data.IsSpringTerm,
            },
            update: {},
          });
          coEducatorIds.push(synthId);
        }

        // Insert the event (skip duplicates via unique constraint).
        try {
          const created = await db.scheduleEvent.create({
            data: {
              educatorId: data.EducatorMasterId,
              subjectId: subject.id,
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
              coEducators: { create: coEducatorIds.map((id) => ({ educatorId: id })) },
            },
          });
          eventsInserted++;
          // suppress unused warning
          void created;
        } catch (e) {
          // Likely unique-constraint violation — skip duplicate.
          if (!String((e as Error).message).includes('Unique constraint')) {
            console.error(`Error inserting event for ${filePath}:`, (e as Error).message);
          }
        }
      }
    }
  }
  return eventsInserted;
}

// ---------- Simultaneous-group computation ----------

async function computeSimultaneousGroups(): Promise<{ teachers: number; groups: number; simultaneousEvents: number }> {
  const teachers = await db.educator.findMany({ where: { id: { gt: 0 } } });
  let groupCount = 0;
  let simultaneousEvents = 0;
  let teachersWithSim = 0;

  let groupCounter = 0;
  for (const teacher of teachers) {
    const events = await db.scheduleEvent.findMany({
      where: { educatorId: teacher.id },
      orderBy: { startDateTime: 'asc' },
      select: { id: true, startDateTime: true, endDateTime: true },
    });
    if (events.length === 0) continue;

    // Sweep-line: group overlapping (chained) intervals.
    type G = { ids: string[]; maxEnd: number; minStart: number };
    const groups: G[] = [];
    let cur: G | null = null;
    for (const ev of events) {
      const s = ev.startDateTime.getTime();
      const e = ev.endDateTime.getTime();
      if (cur && s <= cur.maxEnd) {
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
      const groupId = `sim-${teacher.id}-${groupCounter++}`;
      await db.scheduleEvent.updateMany({
        where: { id: { in: g.ids } },
        data: { simultaneousGroupId: groupId },
      });
      groupCount++;
      simultaneousEvents += g.ids.length;
      hadSim = true;
    }
    if (hadSim) teachersWithSim++;
  }
  return { teachers: teachers.length, groups: groupCount, simultaneousEvents };
}

// ---------- Main ----------

async function main() {
  const dir = process.argv[2] || './upload';
  console.log(`Importing schedules from: ${dir}`);

  // Clear existing schedule data (idempotent re-runs).
  console.log('Clearing existing schedule data...');
  await db.scheduleEventLocation.deleteMany({});
  await db.scheduleEventEducator.deleteMany({});
  await db.scheduleEventGroup.deleteMany({});
  await db.scheduleEvent.deleteMany({});
  await db.location.deleteMany({});
  await db.subject.deleteMany({});
  await db.group.deleteMany({});
  await db.educator.deleteMany({});

  // Walk recursively.
  const files: string[] = [];
  await walkDir(dir, files);
  console.log(`Found ${files.length} JSON file(s).`);

  let totalEvents = 0;
  let ok = 0;
  let failed = 0;
  for (let i = 0; i < files.length; i++) {
    try {
      const n = await importFile(files[i]);
      totalEvents += n;
      ok++;
      if ((i + 1) % 25 === 0 || i === files.length - 1) {
        console.log(`  Processed ${i + 1}/${files.length} files, ${totalEvents} events so far.`);
      }
    } catch (e) {
      failed++;
      console.error(`Error in ${files[i]}:`, (e as Error).message);
    }
  }

  console.log(`Imported ${totalEvents} events from ${ok} file(s) (${failed} failed).`);

  // Compute simultaneous groups.
  console.log('Computing simultaneous groups...');
  const sim = await computeSimultaneousGroups();
  console.log(
    `Simultaneous: ${sim.teachers} teachers, ${sim.groups} groups, ${sim.simultaneousEvents} events flagged.`,
  );

  // Quick sanity stats.
  const teachers = await db.educator.count({ where: { id: { gt: 0 } } });
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

  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
