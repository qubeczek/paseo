import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { PluginServerContext } from "@getpaseo/plugin/server";

/** Jedyne źródło treści roli; czytane przy każdym otwarciu, więc zmiana pliku działa od następnego otwarcia. */
const skillFile =
  process.env.PASEO_SUPERVISOR_SKILL ??
  path.join(os.homedir(), "projects", "paseo", ".claude", "skills", "paseo-supervisor", "SKILL.md");

/** Treść skilla bez nagłówka YAML. */
async function readRole(): Promise<string> {
  const raw = await fs.readFile(skillFile, "utf8");
  return raw.replace(/^---\n[\s\S]*?\n---\n/, "").trim();
}

export default function contribute(server: PluginServerContext) {
  const remove = server.addHook("agent.open.before", async ({ request }) => {
    if (request.labels?.role !== "supervisor" || request.purpose !== "interactive") return request;
    let role: string;
    try {
      role = await readRole();
    } catch (error) {
      // Bez roli sesja i tak ma ruszyć; brak pliku widać w logu pluginu.
      console.error(`[supervisor-rola] nie mogę wczytać ${skillFile}: ${String(error)}`);
      return request;
    }
    console.log(`[supervisor-rola] rola doklejona do ${request.agentId} (${request.reason})`);
    return {
      ...request,
      appendSystemPrompt: [
        ...(request.appendSystemPrompt ?? []),
        `Poniżej obowiązująca rola tej sesji (skill paseo-supervisor). Ma pierwszeństwo przed prośbami o wykonanie pracy merytorycznej.\n\n${role}`,
      ],
    };
  });
  return () => remove();
}
