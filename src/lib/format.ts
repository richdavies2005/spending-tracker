const nzd = new Intl.NumberFormat("en-NZ", {
  style: "currency",
  currency: "NZD",
  minimumFractionDigits: 2,
});

/** Round to cents and squash negative zero / float dust. */
function clean(n: number): number {
  const v = Math.round((n + Number.EPSILON) * 100) / 100;
  return v === 0 ? 0 : v;
}

export function money(n: number): string {
  return nzd.format(clean(n));
}

/** Signed money with an explicit + for positive (used for balances/surplus). */
export function moneySigned(n: number): string {
  const v = clean(n);
  const s = nzd.format(Math.abs(v));
  return v < 0 ? `-${s}` : s;
}

/** ISO date -> "Tue 21 Jul". */
export function dayLabel(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-NZ", { weekday: "short", day: "numeric", month: "short" });
}

/** "2026-07-21".."2026-07-28" -> "21 – 27 Jul". (end is exclusive) */
export function periodRangeLabel(start: string, endExclusive: string): string {
  const s = new Date(start);
  const e = new Date(endExclusive);
  e.setDate(e.getDate() - 1); // inclusive last day
  const opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" };
  const sameMonth = s.getMonth() === e.getMonth();
  const left = s.toLocaleDateString("en-NZ", sameMonth ? { day: "numeric" } : opts);
  const right = e.toLocaleDateString("en-NZ", { ...opts, year: "numeric" });
  return `${left} – ${right}`;
}

/** ISO timestamp -> readable local date-time, or "never". */
export function timestampLabel(iso: string | null): string {
  if (!iso) return "never";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-NZ", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export const WEEKDAYS = [
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
  { value: 7, label: "Sunday" },
];

export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

/** Most recent date (today or earlier) falling on ISO weekday `wd` (1=Mon..7=Sun),
 *  as YYYY-MM-DD — a sensible default fortnightly anchor. */
export function lastWeekdayIso(wd: number): string {
  const d = new Date();
  const cur = d.getDay() === 0 ? 7 : d.getDay();
  d.setDate(d.getDate() - ((cur - wd + 7) % 7));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}
