export const clampPosition = (position: number) => Math.min(1, Math.max(0, position));

/** Equal page-sized target regions, independent of the current scroll offset. */
export function pageAtPosition(position: number, pages: number): number {
  return Math.min(Math.max(1, pages), Math.floor(clampPosition(position) * pages) + 1);
}

/** The middle 16% stops; a quadratic ramp gives ample room for reading speed. */
export function speedAtPosition(position: number): number {
  const clamped = clampPosition(position);
  if (clamped >= 0.42 && clamped <= 0.58) return 0;
  const distance = clamped * 2 - 1;
  const magnitude = Math.abs(distance);
  const ramp = (magnitude - 0.16) / 0.84;
  return Math.sign(distance) * 1600 * ramp * ramp;
}
