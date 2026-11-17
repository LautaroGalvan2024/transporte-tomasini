// Preserve the stored instant when a minute-precision input was not edited.
// Rebuilding it would discard seconds and could change a historical UTC offset.
export function tripDateForRequest(
  value: string,
  baselineValue?: string,
  storedInstant?: string,
): string {
  if (storedInstant && value === baselineValue) return storedInstant;
  return new Date(`${value}:00-03:00`).toISOString();
}
