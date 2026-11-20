import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { PluginHookContext, PluginServerContext } from "@getpaseo/plugin/server";
import { classifyFailure, parseReset } from "./server/classify";
import { decide, type PendingFailure } from "./server/decide";

type PaseoApi = PluginHookContext["paseo"];

/** Ta sama fraza co watchdog welthix: sesja ma po prostu dokończyć przerwaną pracę. */
const RESUME_PHRASE = "wróć do przerwanej pracy, bez pytań i nowych decyzji";
const TICK_MS = 60_000;
/** Odstęp między kolejnymi wznowieniami w jednym przebiegu — nie budzić wszystkich naraz. */
const SEND_GAP_MS = 20_000;

const paseoHome = process.env.PASEO_HOME ?? path.join(os.homedir(), ".paseo");
const stateFile = path.join(paseoHome, "plugin-data", "wznawianie", "state.json");
const credentialsFile = path.join(
  process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), ".claude"),
  ".credentials.json",
);

function log(message: string, extra?: Record<string, unknown>) {
  console.log(`[wznawianie] ${message}${extra ? ` ${JSON.stringify(extra)}` : ""}`);
}

/** Tożsamość konta zalogowanego w Claude (`accountUuid`/`organizationUuid`); zmienia ją `/login` na inne konto. */
async function credentialsVersion(): Promise<string | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(credentialsFile, "utf8")) as {
      claudeAiOauth?: { accountUuid?: string; organizationUuid?: string; refreshToken?: string };
    };
    const oauth = parsed.claudeAiOauth;
    const identity = oauth?.accountUuid
      ? `${oauth.accountUuid}/${oauth.organizationUuid ?? ""}`
      : (oauth?.refreshToken ?? null);
    return identity ? createHash("sha256").update(identity).digest("hex").slice(0, 16) : null;
  } catch {
    return null;
  }
}

async function loadState(): Promise<Map<string, PendingFailure>> {
  try {
    const entries = JSON.parse(await fs.readFile(stateFile, "utf8")) as PendingFailure[];
    return new Map(entries.map((entry) => [entry.agentId, entry]));
  } catch {
    return new Map();
  }
}

async function saveState(pending: Map<string, PendingFailure>): Promise<void> {
  await fs.mkdir(path.dirname(stateFile), { recursive: true });
  const tmp = `${stateFile}.tmp`;
  await fs.writeFile(tmp, JSON.stringify([...pending.values()], null, 2));
  await fs.rename(tmp, stateFile);
}

export default function contribute(server: PluginServerContext) {
  let pending = new Map<string, PendingFailure>();
  let paseo: PaseoApi | null = null;
  let ticking = false;
  const ready = loadState().then((loaded) => {
    pending = loaded;
    log(`wczytano ${pending.size} sesji czekających na wznowienie`);
  });

  async function tick() {
    if (ticking || !paseo || pending.size === 0) return;
    ticking = true;
    try {
      const version = await credentialsVersion();
      let sentInThisTick = 0;
      for (const entry of [...pending.values()]) {
        const decision = decide(entry, Date.now(), version);
        if (!decision.send) continue;
        if (sentInThisTick > 0) await new Promise((resolve) => setTimeout(resolve, SEND_GAP_MS));
        entry.attempts += 1;
        entry.lastAttemptAt = Date.now();
        // Po zmianie konta kolejne próby liczą się od nowego konta.
        if (decision.why === "zmiana konta") {
          entry.credentialsVersion = version;
          entry.attempts = 0;
        }
        try {
          await paseo.agents.ref(entry.agentId).send(RESUME_PHRASE);
          sentInThisTick += 1;
          log("wysłano frazę wznowienia", {
            agentId: entry.agentId,
            title: entry.title,
            kind: entry.kind,
            why: decision.why,
          });
        } catch (error) {
          log("nie udało się wysłać frazy wznowienia", {
            agentId: entry.agentId,
            error: error instanceof Error ? error.message : String(error),
          });
          // Sesji nie ma (usunięta, zarchiwizowana) — nie ma czego wznawiać.
          if (/not found|archived/i.test(String(error))) pending.delete(entry.agentId);
        }
        await saveState(pending);
      }
    } finally {
      ticking = false;
    }
  }

  const timer = setInterval(() => void ready.then(tick), TICK_MS);

  const removeTurnHook = server.addHook("agent.turn.after", async (event, context) => {
    await ready;
    paseo = context.paseo;
    // Sesje w tle raportują do rodzica, który sam decyduje o ponowieniu.
    if (event.agent.background || event.agent.provider !== "claude") return;
    const id = event.agent.id;
    if (event.outcome.kind === "completed") {
      if (pending.delete(id)) {
        log("sesja wróciła do pracy", { agentId: id, title: event.agent.title });
        await saveState(pending);
      }
      return;
    }
    if (event.outcome.kind !== "failed") return;
    const message = event.outcome.error.message;
    const previous = pending.get(id);
    const now = Date.now();
    pending.set(id, {
      agentId: id,
      title: event.agent.title,
      kind: classifyFailure(message),
      message: message.slice(0, 500),
      failedAt: previous?.failedAt ?? now,
      resetAt: parseReset(message, now),
      attempts: previous?.attempts ?? 0,
      lastAttemptAt: previous?.lastAttemptAt ?? null,
      credentialsVersion: previous?.credentialsVersion ?? (await credentialsVersion()),
    });
    log("tura padła na błędzie API, sesja czeka na wznowienie", {
      agentId: id,
      title: event.agent.title,
      kind: pending.get(id)!.kind,
      message: message.slice(0, 200),
    });
    await saveState(pending);
  });

  // Klient Paseo przychodzi tylko w kontekście hooka. Po starcie daemona pierwszy start tury
  // (np. budzenie sesji supervisor) daje go, zanim minie pierwszy przebieg.
  const removeTurnStartHook = server.addHook("agent.turn.before", async (_event, context) => {
    paseo = context.paseo;
  });

  const removeArchiveHook = server.addHook("agent.archive.after", async (event) => {
    await ready;
    if (pending.delete(event.agent.id)) await saveState(pending);
  });

  return () => {
    clearInterval(timer);
    removeTurnHook();
    removeTurnStartHook();
    removeArchiveHook();
  };
}
