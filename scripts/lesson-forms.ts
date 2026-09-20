/**
 * Dictionary of lesson forms (формы проведения занятия) and the extractor
 * that parses them out of the event "Subject" text.
 *
 * In the source files the form, when present, is written at the END of the
 * subject name after the last comma: "Математика, лекция". Only known forms
 * are recognized — a whitelist keeps arbitrary tails (e.g. educator names
 * after a comma: "…, Платонова В.М.") out of the dictionary.
 */

/** Canonical display names (with ё where appropriate). */
export const LESSON_FORMS: readonly string[] = [
  'Лекция',
  'Практическое занятие',
  'Семинар',
  'Контрольная работа',
  'Коллоквиум',
  'Лабораторная работа',
  'Урок',
  'Текущий контроль',
  'Показ работ',
  'Консультация',
  'Консультация групповая',
  'Зачёт',
  'Зачёт (пересдача)',
  'Зачёт (комиссия)',
  'Зачёт (сдача)',
  'Экзамен',
  'Экзамен (пересдача)',
  'Экзамен (комиссия)',
  'Экзамен (сдача)',
  'Итоговый зачёт',
  'Итоговый экзамен',
  'Итоговый экзамен (апелляционная комиссия)',
  'Апелляционная комиссия',
  'Защита выпускной работы',
  'Защита выпускной работы (апелляционная комиссия)',
  'Аттестационное испытание',
  'Сам. работа в присутствии преподавателя',
  'Сам. работа под руководством преподавателя',
  'Сам. работа с исп. методических материалов',
]

/** Normalize a form candidate for dictionary lookup: lowercase, ё→е, collapse spaces. */
export function normalizeForm(s: string): string {
  return s.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim()
}

const NORM_TO_CANONICAL = new Map(LESSON_FORMS.map((f) => [normalizeForm(f), f]))

/**
 * Extract the lesson form from a subject name. Returns the canonical form
 * name (from LESSON_FORMS) or null when the subject has no recognized form
 * suffix. The subject name itself is never modified.
 */
export function extractLessonForm(subject: string): string | null {
  if (!subject) return null
  const i = subject.lastIndexOf(',')
  if (i < 0 || i === subject.length - 1) return null
  const tail = subject.slice(i + 1)
  const canonical = NORM_TO_CANONICAL.get(normalizeForm(tail))
  return canonical ?? null
}
