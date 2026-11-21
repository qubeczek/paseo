import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  type ClaudeBridgeState,
  readClaudeBridgeState,
  RemoteControlKeeper,
} from "./remote-control.js";

describe("readClaudeBridgeState", () => {
  let configDir: string | null = null;
  afterEach(async () => {
    if (configDir) await rm(configDir, { recursive: true, force: true });
    configDir = null;
  });

  async function writeEntry(pid: number, entry: unknown): Promise<string> {
    configDir = await mkdtemp(path.join(os.tmpdir(), "claude-rc-"));
    await mkdir(path.join(configDir, "sessions"));
    await writeFile(path.join(configDir, "sessions", `${pid}.json`), JSON.stringify(entry));
    return configDir;
  }

  it("reports a live bridge", async () => {
    const dir = await writeEntry(42, { pid: 42, bridgeSessionId: "session_1" });
    expect(await readClaudeBridgeState(dir, 42)).toBe("connected");
  });

  it("reports a dropped bridge", async () => {
    const dir = await writeEntry(42, { pid: 42, bridgeSessionId: "" });
    expect(await readClaudeBridgeState(dir, 42)).toBe("disconnected");
  });

  it("is unknown without a registry entry or pid", async () => {
    const dir = await writeEntry(42, { pid: 42 });
    expect(await readClaudeBridgeState(dir, 7)).toBe("unknown");
    expect(await readClaudeBridgeState(dir, undefined)).toBe("unknown");
  });

  it("finds a held session's Claude process by session id", async () => {
    const dir = await writeEntry(process.pid, { pid: process.pid, sessionId: "s-1", bridgeSessionId: "" });
    // The wrapper pid has no entry; the live Claude process with the same session id does.
    expect(await readClaudeBridgeState(dir, 7, "s-1")).toBe("disconnected");
    expect(await readClaudeBridgeState(dir, 7, "other")).toBe("unknown");
  });

  it("ignores registry entries of dead processes", async () => {
    const dir = await writeEntry(999_999_999, { pid: 999_999_999, sessionId: "s-1", bridgeSessionId: "x" });
    expect(await readClaudeBridgeState(dir, 7, "s-1")).toBe("unknown");
  });
});

function keeperWith(states: ClaudeBridgeState[]) {
  const calls = { reconnect: 0, giveUp: 0 };
  let index = 0;
  const keeper = new RemoteControlKeeper({
    readState: async () => states[Math.min(index++, states.length - 1)]!,
    reconnect: async () => {
      calls.reconnect += 1;
      return true;
    },
    onGiveUp: () => {
      calls.giveUp += 1;
    },
  });
  return { keeper, calls };
}

describe("RemoteControlKeeper", () => {
  it("reconnects after the drop is seen on two ticks", async () => {
    const { keeper, calls } = keeperWith(["connected", "disconnected", "disconnected"]);
    await keeper.tick();
    await keeper.tick();
    expect(calls.reconnect).toBe(0);
    await keeper.tick();
    expect(calls.reconnect).toBe(1);
  });

  it("never touches a live or unknown bridge", async () => {
    const { keeper, calls } = keeperWith(["connected", "unknown", "connected", "unknown"]);
    for (let i = 0; i < 4; i += 1) await keeper.tick();
    expect(calls.reconnect).toBe(0);
  });

  it("spaces out tries and gives up after the limit", async () => {
    const { keeper, calls } = keeperWith(["disconnected"]);
    // 1 observation tick, then tries at ticks 2, 8 and 19 (waits of 5 and 10 ticks), give-up at 35.
    for (let i = 0; i < 40; i += 1) await keeper.tick();
    expect(calls.reconnect).toBe(3);
    expect(calls.giveUp).toBe(1);
  });
});
