import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { PluginServerContext } from "@getpaseo/plugin/server";

/**
 * Jedyne źródło treści roli; czytane przy każdym otwarciu, więc zmiana pliku działa od następnego otwarcia.
 * Kolejność: zmienna środowiskowa, katalog sesji (VPS: ~/projects/paseo/.claude/skills → src/ops/skills;
 * Windows: sesja w korzeniu klonu C:\projects\paseo → ops/skills), na końcu stara ścieżka z VPS.
 */
function skillCandidates(cwd: string): string[] {
  const rel = ["paseo-supervisor", "SKILL.md"];
  return [
    ...(process.env.PASEO_SUPERVISOR_SKILL ? [process.env.PASEO_SUPERVISOR_SKILL] : []),
    path.join(cwd, ".claude", "skills", ...rel),
    path.join(cwd, "ops", "skills", ...rel),
    path.join(cwd, "src", "ops", "skills", ...rel),
    path.join(os.homedir(), "projects", "paseo", ".claude", "skills", ...rel),
  ];
}

/** Treść skilla bez nagłówka YAML (także z końcami linii CRLF z Windows). */
async function readRole(cwd: string): Promise<{ file: string; role: string }> {
  const tried = skillCandidates(cwd);
  for (const file of tried) {
    try {
      const raw = (await fs.readFile(file, "utf8")).replace(/\r\n/g, "\n");
      return { file, role: raw.replace(/^---\n[\s\S]*?\n---\n/, "").trim() };
    } catch {
      // następny kandydat
    }
  }
  throw new Error(`brak skilla paseo-supervisor; sprawdzone: ${tried.join(", ")}`);
}

export default function contribute(server: PluginServerContext) {
  const remove = server.addHook("agent.open.before", async ({ request }) => {
    if (request.labels?.role !== "supervisor" || request.purpose !== "interactive") return request;
    let role: string;
    try {
      const found = await readRole(request.cwd);
      role = found.role;
      console.log(`[supervisor-rola] rola z ${found.file} doklejona do ${request.agentId} (${request.reason})`);
    } catch (error) {
      // Bez roli sesja i tak ma ruszyć; brak pliku widać w logu pluginu.
      console.error(`[supervisor-rola] ${String(error)}`);
      return request;
    }
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
