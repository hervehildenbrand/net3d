/**
 * Normalize a role colour value to valid CSS.
 * The API returns bare 6-digit hex (e.g. 'ff9800'), but CSS needs '#ff9800'.
 */
const HEX6_RE = /^#?([0-9a-f]{6})$/i

export function cssColor(hex: string | null | undefined): string | null {
  if (!hex) return null
  const match = hex.match(HEX6_RE)
  if (!match) return null
  return `#${match[1]!.toLowerCase()}`
}
