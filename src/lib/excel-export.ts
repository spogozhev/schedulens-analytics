import ExcelJS from 'exceljs'

/**
 * One row of the teachers-rating export. Mirrors the columns of the rating
 * table on the "Преподаватели" tab; hours are already converted and rounded
 * to 1 decimal by the caller (same as the JSON API).
 */
export interface TeacherRatingRow {
  rank: number
  name: string
  eventsCount: number
  effectiveHours: number
  scheduledHours: number
  simultaneousGroups: number
  simultaneousEvents: number
  timeSavedHours: number
  inferredEndEvents: number
  canceledEvents: number
}

const COUNT_FMT = '#,##0'
const HOURS_FMT = '0.0'
const DATE_FMT = 'DD.MM.YYYY'

interface ColumnDef {
  header: string
  key: keyof TeacherRatingRow
  width: number
  numFmt?: string
}

/**
 * Build the teachers-rating workbook. The column set matches the rating
 * table: the mini-bar column is visual-only and is not exported, while the
 * two warning counters shown inline under the teacher name ("без конца" /
 * "отменено") become their own columns. Cell values are written as real
 * numbers so Excel can sort and aggregate them.
 */
export function buildTeachersRatingWorkbook(
  rows: TeacherRatingRow[],
  academic: boolean,
): ExcelJS.Workbook {
  const columns: ColumnDef[] = [
    { header: '№', key: 'rank', width: 6, numFmt: '0' },
    { header: 'Преподаватель', key: 'name', width: 44 },
    { header: 'Занятий', key: 'eventsCount', width: 10, numFmt: COUNT_FMT },
    {
      header: academic ? 'Эфф. ак. часов' : 'Эфф. часов',
      key: 'effectiveHours',
      width: 13,
      numFmt: HOURS_FMT,
    },
    {
      header: academic ? 'Заплан. ак. часов' : 'Заплан. часов',
      key: 'scheduledHours',
      width: 14,
      numFmt: HOURS_FMT,
    },
    { header: 'Одновр. группы', key: 'simultaneousGroups', width: 13, numFmt: COUNT_FMT },
    { header: 'Одновр. событий', key: 'simultaneousEvents', width: 13, numFmt: COUNT_FMT },
    {
      header: academic ? 'Экономия, ак. ч' : 'Экономия, ч',
      key: 'timeSavedHours',
      width: 13,
      numFmt: HOURS_FMT,
    },
    { header: 'Событий без конца', key: 'inferredEndEvents', width: 14, numFmt: COUNT_FMT },
    { header: 'Отменено событий', key: 'canceledEvents', width: 14, numFmt: COUNT_FMT },
  ]

  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Рейтинг', { views: [{ state: 'frozen', ySplit: 1 }] })
  ws.autoFilter = { from: 'A1', to: { row: 1, column: columns.length } }

  const headerRow = ws.getRow(1)
  columns.forEach((c, i) => {
    const cell = headerRow.getCell(i + 1)
    cell.value = c.header
    cell.font = { bold: true }
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFF2F2F2' },
    }
    cell.alignment = { horizontal: c.numFmt ? 'right' : 'left', vertical: 'middle' }
    ws.getColumn(i + 1).width = c.width
  })
  headerRow.height = 20

  rows.forEach((r) => {
    const row = ws.addRow(columns.map((c) => r[c.key]))
    columns.forEach((c, i) => {
      if (!c.numFmt) return
      const cell = row.getCell(i + 1)
      cell.numFmt = c.numFmt
      cell.alignment = { horizontal: 'right' }
    })
  })

  return wb
}

/**
 * One row of the teacher-events export — every event of a teacher in the
 * current filter period, one row per event. The date is a real Date so
 * Excel can sort/filter it; list fields (groups, locations, co-teachers)
 * are pre-joined into strings by the caller.
 */
export interface TeacherEventRow {
  date: Date
  time: string
  durationMinutes: number
  subject: string
  kind: string
  lessonForm: string
  groups: string
  address: string
  coEducators: string
}

/** Excel sheet names: max 31 chars, no []:*?/\ characters. */
function sheetNameOf(name: string): string {
  const cleaned = name.replace(/[[\]:*?/\\]/g, ' ').trim()
  return (cleaned.length > 31 ? cleaned.slice(0, 31) : cleaned) || 'События'
}

/**
 * Build the teacher-events workbook: all events of one teacher, one row per
 * event, in the column order requested for the teacher card export.
 */
export function buildTeacherEventsWorkbook(
  rows: TeacherEventRow[],
  teacherName: string,
): ExcelJS.Workbook {
  const columns: Array<{ header: string; key: keyof TeacherEventRow; width: number; numFmt?: string }> = [
    { header: 'Дата', key: 'date', width: 12, numFmt: DATE_FMT },
    { header: 'Время', key: 'time', width: 16 },
    { header: 'Длительность, мин', key: 'durationMinutes', width: 13, numFmt: COUNT_FMT },
    { header: 'Дисциплина', key: 'subject', width: 46 },
    { header: 'Тип занятия', key: 'kind', width: 18 },
    { header: 'Вид (форма) занятия', key: 'lessonForm', width: 20 },
    { header: 'Группа', key: 'groups', width: 26 },
    { header: 'Адрес', key: 'address', width: 44 },
    { header: 'Сопреподаватели', key: 'coEducators', width: 32 },
  ]

  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet(sheetNameOf(teacherName), { views: [{ state: 'frozen', ySplit: 1 }] })
  ws.autoFilter = { from: 'A1', to: { row: 1, column: columns.length } }

  const headerRow = ws.getRow(1)
  columns.forEach((c, i) => {
    const cell = headerRow.getCell(i + 1)
    cell.value = c.header
    cell.font = { bold: true }
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFF2F2F2' },
    }
    cell.alignment = { horizontal: c.numFmt ? 'right' : 'left', vertical: 'middle' }
    ws.getColumn(i + 1).width = c.width
  })
  headerRow.height = 20

  rows.forEach((r) => {
    const row = ws.addRow(columns.map((c) => r[c.key]))
    columns.forEach((c, i) => {
      if (!c.numFmt) return
      const cell = row.getCell(i + 1)
      cell.numFmt = c.numFmt
      cell.alignment = { horizontal: 'right' }
    })
  })

  return wb
}
