/**
 * Small formatting helpers shared by the graph table.
 *
 * Deliberately dependency-free: Obsidian plugins must not pull in a date
 * library, so the default layout (`DD Mon YYYY HH:mm`) is produced by a tiny
 * token replacer. Supported tokens: `YYYY`, `YY`, `MM`, `M`, `DD`, `D`, `Mon`,
 * `HH`, `H`, `mm`, `ss`; everything else is copied verbatim.
 */

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/** Default table date format. */
const DEFAULT_DATE_FORMAT = 'DD Mon YYYY HH:mm';

/**
 * Token alternatives are ordered longest-first within each family so `MM`/`Mon`
 * are consumed before bare `M`; a short token can never eat a longer one.
 */
const TOKEN = /Mon|YYYY|YY|MM|M|DD|D|HH|H|mm|ss/g;

/** Zero-pad a non-negative integer to at least two digits. */
function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/**
 * Format a git timestamp (seconds since the epoch) in the local time zone.
 *
 * `pattern` defaults to `DD Mon YYYY HH:mm` (e.g. `03 Nov 2026 09:05`).
 * Invalid/non-finite timestamps produce an empty string so a broken commit
 * record cannot take down the table.
 */
export function formatDate(
  seconds: number,
  pattern: string = DEFAULT_DATE_FORMAT,
): string {
  if (!Number.isFinite(seconds) || typeof pattern !== 'string') return '';
  const date = new Date(seconds * 1000);
  if (Number.isNaN(date.getTime())) return '';

  const year = date.getFullYear();
  const month = date.getMonth();
  const day = date.getDate();
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const secondsOfMinute = date.getSeconds();

  const values: Record<string, string> = {
    YYYY: String(year),
    YY: pad2(year % 100),
    MM: pad2(month + 1),
    M: String(month + 1),
    Mon: MONTHS[month],
    DD: pad2(day),
    D: String(day),
    HH: pad2(hours),
    H: String(hours),
    mm: pad2(minutes),
    ss: pad2(secondsOfMinute),
  };

  return pattern.replace(TOKEN, (token) => values[token] ?? token);
}

/** First line of a commit message, trimmed; empty input stays empty. */
export function firstLine(message: string): string {
  if (!message) return '';
  return message.split(/\r\n|\r|\n/, 1)[0]?.trim() ?? '';
}

/** Relative label used by the commit list (reference: `2 hours ago`). */
export function formatRelative(seconds: number, now: number = Date.now()): string {
  if (!Number.isFinite(seconds)) return '';
  const from = new Date(seconds * 1000);
  if (Number.isNaN(from.getTime())) return '';
  const to = new Date(now);
  const ago = (n: number, unit: string): string => `${n} ${unit}${n === 1 ? '' : 's'} ago`;
  const months =
    (to.getUTCFullYear() - from.getUTCFullYear()) * 12 +
    (to.getUTCMonth() - from.getUTCMonth()) -
    (to.getUTCDate() < from.getUTCDate() ? 1 : 0);
  if (months >= 12) return ago(Math.floor(months / 12), 'year');
  if (months >= 1) return ago(months, 'month');
  const elapsed = Math.max(0, Math.floor((now - from.getTime()) / 1000));
  for (const [unit, size] of [['day', 86400], ['hour', 3600], ['minute', 60]] as const) {
    if (elapsed >= size) return ago(Math.floor(elapsed / size), unit);
  }
  return 'just now';
}
