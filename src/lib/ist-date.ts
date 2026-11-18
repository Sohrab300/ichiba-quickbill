/**
 * Calendar dates in India (Asia/Kolkata, UTC+05:30, no DST). Pure; safe anywhere.
 * A "date" here is a YYYY-MM-DD string meaning that day in IST.
 */

const IST_OFFSET_MS = 330 * 60_000;
const DAY_MS = 24 * 60 * 60_000;

/** Wall-clock fields of an instant in IST. */
function istParts(instant: Date) {
  const ist = new Date(instant.getTime() + IST_OFFSET_MS);
  return {
    year: ist.getUTCFullYear(),
    month: ist.getUTCMonth() + 1,
    day: ist.getUTCDate(),
    hour: ist.getUTCHours(),
    minute: ist.getUTCMinutes(),
    second: ist.getUTCSeconds(),
  };
}

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

/** The IST date of an instant, e.g. "2026-11-15". */
export function istDateOf(instant: Date | string): string {
  const p = istParts(new Date(instant));
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}`;
}

/** The IST time of an instant, 24-hour, e.g. "18:32:05". */
export function istTimeOf(instant: Date | string): string {
  const p = istParts(new Date(instant));
  return `${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`;
}

/** Today in IST. */
export function todayIst(now: Date = new Date()): string {
  return istDateOf(now);
}

/** The value if it is a real calendar date in YYYY-MM-DD form (2000–2099), else null. */
export function parseIstDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const m = /^(20\d{2})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const check = new Date(Date.UTC(y, mo - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null;
  return value;
}

/** Days since 1970-01-01 of a date that passed parseIstDate() (calendar arithmetic only). */
function dayNumber(date: string): number {
  const [y, mo, d] = date.split("-").map(Number);
  return Date.UTC(y, mo - 1, d) / DAY_MS;
}

/** The date `days` days after (or before, if negative) `date`: ("2026-03-01", -1) → "2026-02-28". */
export function addIstDays(date: string, days: number): string {
  return new Date((dayNumber(date) + days) * DAY_MS).toISOString().slice(0, 10);
}

/** Calendar days from `from` to `to`, both included: same day → 1. Negative-or-zero when to < from. */
export function istDaysInclusive(from: string, to: string): number {
  return dayNumber(to) - dayNumber(from) + 1;
}

/** [from, to) covering the whole IST day, as UTC instants. `date` must pass parseIstDate(). */
export function istDayRange(date: string): { from: Date; to: Date } {
  const [y, mo, d] = date.split("-").map(Number);
  const from = new Date(Date.UTC(y, mo - 1, d) - IST_OFFSET_MS);
  return { from, to: new Date(from.getTime() + DAY_MS) };
}
