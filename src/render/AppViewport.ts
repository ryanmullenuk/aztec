/** Use the drawable viewport, never the physical display (which can include iOS chrome). */
export function viewportSize(width: number, height: number, visualWidth = width, visualHeight = height): [number, number] {
  return [Math.min(width, visualWidth), Math.min(height, visualHeight)];
}
