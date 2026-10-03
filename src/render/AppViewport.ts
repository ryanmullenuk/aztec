/** Home Screen apps use the full display; normal browser tabs use their available viewport. */
export function viewportSize(width: number, height: number, screenWidth: number, screenHeight: number, standalone: boolean): [number, number] {
  if (!standalone) return [width, height];
  const landscape = width > height;
  const sw = landscape ? Math.max(screenWidth, screenHeight) : Math.min(screenWidth, screenHeight);
  const sh = landscape ? Math.min(screenWidth, screenHeight) : Math.max(screenWidth, screenHeight);
  // Do not expand iPad split-screen windows to the size of the physical display.
  return Math.abs(sw - width) <= 3 ? [width, Math.max(height, sh)] : [width, height];
}
