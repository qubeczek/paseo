// Klasyfikacja błędu, na którym padła tura, i godzina resetu limitu z komunikatu.
// Te same reguły co watchdog sesji welthix (.claude/scripts/harness/session_watchdog.py).

/**
 * AUTH: wylogowanie, wygasły token, brak środków — wznawia tylko zmiana konta.
 * WEEKLY: limit tygodniowy lub limit wydatków — po godzinie resetu, zmianie konta albo rzadko.
 * RESUME: okno limitu, przeciążenie, inne błędy API — wkrótce, z limitem prób.
 */
export type FailureKind = "AUTH" | "WEEKLY" | "RESUME";

const AUTH_NEEDLES = [
  "not logged in",
  "/login",
  "please log in",
  "oauth token",
  "token has expired",
  "token expired",
  "invalid api key",
  "invalid x-api-key",
  "authentication_error",
  "credit balance is too low",
  "insufficient credit",
  "insufficient funds",
  "payment required",
];
const WEEKLY_NEEDLES = ["weekly limit", "week limit", "weekly usage", "spend limit"];

export function classifyFailure(message: string): FailureKind {
  const low = message.toLowerCase();
  if (AUTH_NEEDLES.some((needle) => low.includes(needle))) return "AUTH";
  if (WEEKLY_NEEDLES.some((needle) => low.includes(needle))) return "WEEKLY";
  return "RESUME";
}

const EPOCH_RE = /\|(\d{10})\b/;
const RESET_RE =
  /resets?\s+(?:at\s+|on\s+)?(?:(?<mon>[A-Za-z]{3})[a-z]*\.?\s+(?<day>\d{1,2}),?\s+(?:at\s+)?)?(?<h>\d{1,2})(?::(?<m>\d{2}))?\s*(?<ap>am|pm)?(?:\s*\((?<tz>[^)]+)\))?/i;
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** Offset strefy `timeZone` względem UTC (ms) w chwili `at`. */
function zoneOffsetMs(timeZone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - at.getTime();
}

function validZone(name: string | undefined): string | null {
  if (!name) return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: name.trim() });
    return name.trim();
  } catch {
    return null;
  }
}

/**
 * Godzina resetu limitu z komunikatu (ms od epoki), pierwsza po `after`; null, gdy komunikat jej
 * nie podaje. Bez strefy w nawiasie liczy w strefie procesu.
 */
export function parseReset(message: string, after: number): number | null {
  const epoch = EPOCH_RE.exec(message);
  if (epoch) return Number(epoch[1]) * 1000;
  const match = RESET_RE.exec(message);
  if (!match?.groups) return null;
  const { mon, day, h, m, ap, tz } = match.groups;
  let hour = Number(h);
  const minute = Number(m ?? 0);
  const meridiem = (ap ?? "").toLowerCase();
  if (meridiem === "pm" && hour < 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return null;
  const zone = validZone(tz) ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const offset = zoneOffsetMs(zone, new Date(after));
  const local = new Date(after + offset);
  let year = local.getUTCFullYear();
  let month = local.getUTCMonth();
  let date = local.getUTCDate();
  const monthIndex = mon ? MONTHS.indexOf(mon.toLowerCase()) : -1;
  if (monthIndex >= 0 && day) {
    month = monthIndex;
    date = Number(day);
  }
  let candidate = Date.UTC(year, month, date, hour, minute) - offset;
  if (candidate <= after) {
    if (monthIndex >= 0) {
      year += 1;
      candidate = Date.UTC(year, month, date, hour, minute) - offset;
    } else {
      candidate += 24 * 60 * 60 * 1000;
    }
  }
  return candidate;
}
