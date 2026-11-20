// One status function for every place on the board: priority, label and color of a session.
import type { PluginAgentSnapshot, PluginTheme } from "@getpaseo/plugin";

export type StateKind = "permission" | "error" | "paused" | "working" | "background" | "finished" | "idle";

export interface SessionState {
  kind: StateKind;
  /** Lower first: what needs the owner comes first. */
  priority: number;
  label: string;
  /** Needs the owner now (counts in "Zajrzyj tutaj"). */
  needsYou: boolean;
}

const PRIORITY: Record<StateKind, number> = {
  permission: 0,
  error: 1,
  finished: 2,
  working: 3,
  background: 4,
  paused: 5,
  idle: 6,
};

export function sessionState(agent: PluginAgentSnapshot, pausedUntil?: number | null | undefined): SessionState {
  const make = (kind: StateKind, label: string, needsYou = false): SessionState => ({
    kind,
    priority: PRIORITY[kind],
    label,
    needsYou,
  });
  if (agent.attentionReason === "permission") return make("permission", "czeka na zgodę", true);
  // A paused session errors on the usage limit; wznawianie brings it back by itself — no alarm.
  if (pausedUntil !== undefined) return make("paused", pausedUntil ? `limit · wznowi ${clock(pausedUntil)}` : "limit · wznowi sama");
  if (agent.status === "error") return make("error", "błąd", true);
  if (agent.status === "running" || agent.status === "initializing") return make("working", "pracuje");
  if (agent.backgroundWork.count > 0) return make("background", `${agent.backgroundWork.count} zad. w tle`);
  if (agent.requiresAttention && agent.attentionReason === "finished") return make("finished", "skończyła, nieprzeczytane");
  if (agent.status === "closed") return make("idle", "uśpiona");
  return make("idle", "bezczynna");
}

export function stateColor(kind: StateKind, theme: PluginTheme): string {
  const c = theme.colors;
  switch (kind) {
    case "permission":
      return c.statusWarning;
    case "error":
      return c.statusDanger;
    case "working":
    case "background":
      return c.accent;
    case "finished":
      return c.statusSuccess;
    default:
      return c.foregroundMuted;
  }
}

export function clock(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function since(iso: string, now = Date.now()): string {
  const minutes = Math.max(0, Math.round((now - Date.parse(iso)) / 60000));
  if (minutes < 1) return "teraz";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ${minutes % 60 ? `${minutes % 60} min` : ""}`.trim();
  return `${Math.floor(hours / 24)} dn.`;
}

/** Story short key in a session title: "w-0-206", "w-0-206-(1)", "story-90-149 (01)" → "0-206" / "90-149". */
export function storyOf(title: string | null): string | null {
  if (!title) return null;
  const match = /(?:^|[-\s])(\d+[a-z]?-\d+[a-z]?)(?=$|[-\s(])/i.exec(title);
  return match ? match[1].toLowerCase() : null;
}
