/** Mounting face of a device in a rack, normalized for display. */
export type FaceLabel = 'front' | 'rear' | 'full-depth'

/**
 * Normalize a NetBox device face ('FRONT'|'REAR'|null|lowercase) to a display
 * label. Full-depth devices span both faces, so that wins. Anything unknown or
 * absent falls back to 'front' (NetBox's default mounting face).
 */
export function faceLabel(face: string | null, isFullDepth: boolean): FaceLabel {
  if (isFullDepth) return 'full-depth'
  return (face ?? '').toLowerCase() === 'rear' ? 'rear' : 'front'
}

/**
 * Whether a device should be emphasized for the current rack camera side.
 * Full-depth devices match both sides; otherwise the device's mounting face
 * must equal the view ('front'|'rear'). A null/unknown face reads as front.
 */
export function faceMatchesView(
  device: { face: string | null; isFullDepth: boolean },
  view: 'front' | 'rear',
): boolean {
  const label = faceLabel(device.face, device.isFullDepth)
  return label === 'full-depth' || label === view
}
