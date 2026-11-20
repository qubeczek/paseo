import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { backlogFor } from "./server/backlog";
import { boardStatus, layoutSettings, type Backlog, type Paused } from "./shared/contracts";

const paseoHome = process.env.PASEO_HOME || path.join(os.homedir(), ".paseo");

/** Sessions the wznawianie plugin holds after a usage limit or API error (quiet on the board). */
async function readPaused(): Promise<Paused[]> {
  try {
    const raw = await fs.readFile(path.join(paseoHome, "plugin-data", "wznawianie", "state.json"), "utf8");
    const entries = JSON.parse(raw) as { agentId?: unknown; kind?: unknown; resetAt?: unknown }[];
    return entries
      .filter((entry) => typeof entry.agentId === "string")
      .map((entry) => ({
        agentId: entry.agentId as string,
        kind: typeof entry.kind === "string" ? entry.kind : "api",
        resetAt: typeof entry.resetAt === "number" ? entry.resetAt : null,
      }));
  } catch {
    return [];
  }
}

export default function contribute(server: PluginServerContext) {
  server.registerSettings(layoutSettings);
  server.handle(boardStatus, async ({ roots }) => {
    const unique = [...new Set(roots)];
    const backlogs = (await Promise.all(unique.map(backlogFor))).filter(
      (backlog): backlog is Backlog => backlog !== null,
    );
    return { backlogs, paused: await readPaused() };
  });
  return () => {};
}
