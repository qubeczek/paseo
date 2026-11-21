import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Whether Claude's session registry (`<configDir>/sessions/<pid>.json`) shows a live Remote Control
 * bridge for the process. Claude clears `bridgeSessionId` when the bridge drops, e.g. after an
 * account switch with `/login`, and never reconnects on its own after that. `unknown` when the
 * process has not written its entry yet or the entry cannot be read.
 */
export type ClaudeBridgeState = "connected" | "disconnected" | "unknown";

function bridgeOf(entry: unknown): ClaudeBridgeState {
  if (typeof entry !== "object" || entry === null) return "unknown";
  const bridge = (entry as { bridgeSessionId?: unknown }).bridgeSessionId;
  return typeof bridge === "string" && bridge.length > 0 ? "connected" : "disconnected";
}

function alive(pid: unknown): boolean {
  if (typeof pid !== "number") return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Reads the registry entry of the Claude process: by its pid, or, when Paseo does not know that pid
 * (a held session runs Claude under the `claude-hold` wrapper, so the child pid is the wrapper's),
 * by the Claude session id among entries of live processes.
 */
export async function readClaudeBridgeState(
  configDir: string,
  pid: number | undefined,
  sessionId?: string | null,
): Promise<ClaudeBridgeState> {
  const dir = path.join(configDir, "sessions");
  if (pid !== undefined) {
    try {
      return bridgeOf(JSON.parse(await fs.readFile(path.join(dir, `${pid}.json`), "utf8")));
    } catch {
      // Not Claude's own pid (held session) or not written yet: fall back to the session id.
    }
  }
  if (!sessionId) return "unknown";
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return "unknown";
  }
  let best: { updatedAt: number; entry: unknown } | null = null;
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    let entry: { sessionId?: unknown; pid?: unknown; updatedAt?: unknown };
    try {
      entry = JSON.parse(await fs.readFile(path.join(dir, name), "utf8"));
    } catch {
      continue;
    }
    if (entry?.sessionId !== sessionId || !alive(entry.pid)) continue;
    const updatedAt = typeof entry.updatedAt === "number" ? entry.updatedAt : 0;
    if (!best || updatedAt > best.updatedAt) best = { updatedAt, entry };
  }
  return best ? bridgeOf(best.entry) : "unknown";
}

export interface RemoteControlKeeperOptions {
  readState: () => Promise<ClaudeBridgeState>;
  /** Registers the bridge again; resolves true when Claude returned a session URL. */
  reconnect: () => Promise<boolean>;
  onGiveUp: () => void;
  maxTries?: number;
}

/**
 * Re-registers Remote Control when the bridge of a running Claude process drops. One `tick()` per
 * check interval. A drop must be seen on two consecutive ticks before reconnecting; tries are
 * limited and spaced out (try n waits n * 5 ticks), and a live bridge resets the count.
 */
export class RemoteControlKeeper {
  private misses = 0;
  private tries = 0;
  private wait = 0;
  private gaveUp = false;
  private running = false;
  private readonly maxTries: number;

  constructor(private readonly options: RemoteControlKeeperOptions) {
    this.maxTries = options.maxTries ?? 3;
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.check();
    } finally {
      this.running = false;
    }
  }

  private async check(): Promise<void> {
    const state = await this.options.readState();
    if (state === "connected") {
      this.misses = 0;
      this.tries = 0;
      this.wait = 0;
      this.gaveUp = false;
      return;
    }
    if (state === "unknown" || this.gaveUp) return;
    this.misses += 1;
    if (this.misses < 2) return;
    if (this.wait > 0) {
      this.wait -= 1;
      return;
    }
    if (this.tries >= this.maxTries) {
      this.gaveUp = true;
      this.options.onGiveUp();
      return;
    }
    this.tries += 1;
    this.wait = this.tries * 5;
    await this.options.reconnect();
  }
}
