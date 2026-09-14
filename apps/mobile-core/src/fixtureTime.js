// Database time values may include seconds; fixture controls use minute precision.
export function normalizeFixtureTime(value) {
  const input = String(value ?? '').trim()
  return /^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?$/.test(input) ? input.slice(0, 5) : input
}
