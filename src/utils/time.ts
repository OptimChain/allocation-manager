// Blob/engine timestamps are naive UTC ("2026-05-01T14:30:00", no zone), and
// `new Date()` would read those as browser-local time. Route every server
// timestamp through here instead.

const HAS_ZONE = /(Z|[+-]\d{2}:?\d{2})$/i;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/; // already parsed as UTC by the spec

/** Parse a server timestamp, treating zone-less values as UTC. */
export function parseUtc(value: string | number | null | undefined): Date {
  if (value == null || value === '') return new Date(NaN);
  if (typeof value === 'number') return new Date(value);
  const s = value.trim();
  return new Date(HAS_ZONE.test(s) || DATE_ONLY.test(s) ? s : s + 'Z');
}

/** Epoch ms for a server timestamp (NaN when unparseable). */
export function utcMs(value: string | number | null | undefined): number {
  return parseUtc(value).getTime();
}
