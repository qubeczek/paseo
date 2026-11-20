// Decyzja, czy wysłać sesji frazę wznowienia. Czysta funkcja: stan wpisu + chwila + sygnał zmiany konta.
import type { FailureKind } from "./classify";

export interface PendingFailure {
  agentId: string;
  title: string | null;
  kind: FailureKind;
  message: string;
  failedAt: number;
  /** Godzina resetu limitu z komunikatu, jeśli ją podał. */
  resetAt: number | null;
  attempts: number;
  lastAttemptAt: number | null;
  /** Wersja poświadczeń Claude w chwili błędu; inna wersja = zmiana konta. */
  credentialsVersion: string | null;
}

export type Decision = { send: true; why: string } | { send: false; why: string };

const MINUTE = 60_000;
/** Postój przed pierwszą próbą — błąd przeciążenia często mija sam. */
export const STALL_MS = 3 * MINUTE;
/** Odstęp między próbami RESUME. */
export const RESUME_RETRY_MS = 15 * MINUTE;
/** Odstęp między próbami WEEKLY, gdy komunikat nie podał resetu. */
export const WEEKLY_RETRY_MS = 60 * MINUTE;
export const MAX_ATTEMPTS = 5;

export function decide(
  entry: PendingFailure,
  now: number,
  credentialsVersion: string | null,
): Decision {
  const accountChanged =
    credentialsVersion !== null &&
    entry.credentialsVersion !== null &&
    credentialsVersion !== entry.credentialsVersion;
  const since = entry.lastAttemptAt ?? entry.failedAt;
  if (accountChanged && (entry.lastAttemptAt === null || now - entry.lastAttemptAt >= MINUTE)) {
    return { send: true, why: "zmiana konta" };
  }
  if (entry.kind === "AUTH") return { send: false, why: "czeka na zmianę konta" };
  if (entry.attempts >= MAX_ATTEMPTS) return { send: false, why: "wyczerpane próby" };
  if (entry.resetAt !== null) {
    if (now < entry.resetAt) return { send: false, why: "przed godziną resetu" };
    if (entry.lastAttemptAt === null || entry.lastAttemptAt < entry.resetAt) {
      return { send: true, why: "po godzinie resetu" };
    }
  }
  if (now - entry.failedAt < STALL_MS) return { send: false, why: "postój krótszy niż 3 min" };
  const retry = entry.kind === "WEEKLY" ? WEEKLY_RETRY_MS : RESUME_RETRY_MS;
  if (entry.lastAttemptAt !== null && now - since < retry) {
    return { send: false, why: "za wcześnie na kolejną próbę" };
  }
  return { send: true, why: `próba ${entry.attempts + 1}/${MAX_ATTEMPTS}` };
}
