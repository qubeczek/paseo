import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Whether Claude's session registry (`<configDir>/sessions/<pid>.json`) shows a live Remote Control
 * bridge for the process. Claude clears `bridgeSessionId` when the bridge drops, e.g. after an
 * account switch with `/login`, and never reconnects on its own after that. `unknown` when the
 * process has not written its entry yet or the entry cannot be read.
 */
export type ClaudeBridgeState = "connected" | "disconnected" | "unknown";

export async function readClaudeBridgeState(
  configDir: string,
  pid: number | undefined,
): Promise<ClaudeBridgeState> {
  if (pid === undefined) return "unknown";
  let entry: unknown;
  try {
    entry = JSON.parse(await fs.readFile(path.join(configDir, "sessions", `${pid}.json`), "utf8"));
  } catch {
    return "unknown";
  }
  if (typeof entry !== "object" || entry === null) return "unknown";
  const bridge = (entry as { bridgeSessionId?: unknown }).bridgeSessionId;
  return typeof bridge === "string" && bridge.length > 0 ? "connected" : "disconnected";
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
