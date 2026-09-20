/**
 * Parses the display name of a location into its address part.
 *
 * Source format (99.4% of rows):
 *   "<Улица>, д. <дом>[, лит. X][, пом. Y], <номер аудитории>"
 * The address is everything up to and including the first "д. N" segment;
 * the rest (lit./room number) stays part of the location display name.
 * Whitespace is collapsed. Rows without a "д. N" segment (virtual places
 * like "по месту проведения практики") have no address.
 */
export function parseLocationAddress(displayName: string): { address: string } | null {
  const parts = displayName
    .split(',')
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
  const houseIdx = parts.findIndex((p) => /^д\./i.test(p))
  if (houseIdx < 0) return null
  return { address: parts.slice(0, houseIdx + 1).join(', ') }
}
