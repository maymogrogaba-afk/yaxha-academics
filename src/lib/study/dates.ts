// Date helpers that work with plain "YYYY-MM-DD" calendar dates in the user's time zone.

export function todayIn(tz: string, now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function dateIn(tz: string, d: Date): string {
  return todayIn(tz, d);
}

export function addDays(date: string, n: number): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / 86_400_000);
}

/** 0 = Sunday ... 6 = Saturday */
export function weekday(date: string): number {
  return new Date(date + "T00:00:00Z").getUTCDay();
}

export function formatDate(date: string | Date, tz = "Asia/Manila", opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" }) {
  const d = typeof date === "string" ? new Date(date.length === 10 ? date + "T12:00:00Z" : date) : date;
  return new Intl.DateTimeFormat("en-PH", { timeZone: typeof date === "string" && date.length === 10 ? "UTC" : tz, ...opts }).format(d);
}

export function formatDateTime(d: Date | string, tz = "Asia/Manila") {
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: tz,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(d));
}

export function relativeDays(date: string, today: string): string {
  const n = daysBetween(today, date);
  if (n === 0) return "today";
  if (n === 1) return "tomorrow";
  if (n === -1) return "yesterday";
  return n > 0 ? `in ${n} days` : `${-n} days ago`;
}

export function minutesLabel(min: number) {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** Minutes the time zone is ahead of UTC at the given instant (Manila = +480). */
export function tzOffsetMinutes(tz: string, at: Date): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return Math.round((asUtc - at.getTime()) / 60000);
}

/** Converts a "YYYY-MM-DDTHH:mm" wall-clock time in `tz` to an absolute Date. */
export function zonedToDate(local: string, tz: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) return null;
  const guess = new Date(local + ":00Z");
  const offset = tzOffsetMinutes(tz, guess);
  return new Date(guess.getTime() - offset * 60000);
}

/** The "YYYY-MM-DDTHH:mm" wall-clock value of a Date in `tz` (for datetime-local inputs). */
export function toLocalInput(d: Date | string, tz: string): string {
  const date = new Date(d);
  return new Date(date.getTime() + tzOffsetMinutes(tz, date) * 60000).toISOString().slice(0, 16);
}
