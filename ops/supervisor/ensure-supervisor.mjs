#!/usr/bin/env node
// Pilnuje jednej sesji supervisor po każdym starcie daemona Paseo. Działa na Linuksie i Windows (sam Node).
//   brak sesji z etykietą role=supervisor  -> zakłada ją;
//   sesja jest, ale bez procesu Claude      -> budzi ją jedną wiadomością (proces rusza, rejestruje się Remote Control);
//   proces żyje                             -> nic.
// VPS: paseo-supervisor.service (przez ensure-supervisor.sh). Windows: zadanie Harmonogramu „Paseo daemon”
// (SETUP-WINDOWS.md, krok 4a).
//
// Opcje (wszystkie opcjonalne):
//   --cwd <katalog>    katalog sesji; domyślnie ~/projects/paseo (VPS)
//   --name <nazwa>     tytuł w Paseo = nazwa w Remote Control; domyślnie "supervisor"
//   --scope cluster|local  cluster: VPS, zarządza sesjami w klastrze; local: tylko ta maszyna. Domyślnie cluster.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index > 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const cli = path.join(repo, "packages", "cli", "bin", "paseo");
const home = os.homedir();
const cwd = option("cwd", path.join(home, "projects", "paseo"));
const name = option("name", "supervisor");
const scope = option("scope", "cluster");
if (scope !== "cluster" && scope !== "local") throw new Error(`--scope cluster|local, nie ${scope}`);

const env = { ...process.env, PASEO_HOME: process.env.PASEO_HOME || path.join(home, ".paseo") };
// Hasło daemona tylko z pliku i tylko do procesu CLI (na Windows daemon nie ma hasła).
const passwordFile = path.join(env.PASEO_HOME, "web-password.txt");
if (!env.PASEO_PASSWORD && existsSync(passwordFile)) {
  env.PASEO_PASSWORD = readFileSync(passwordFile, "utf8").trim();
}

function paseo(args) {
  const result = spawnSync(process.execPath, [cli, ...args], { env, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`paseo ${args[0]}: ${(result.stderr || result.stdout || "").trim()}`);
  }
  return result.stdout;
}

async function waitForDaemon() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch("http://127.0.0.1:6767/api/health");
      if (response.ok) return;
    } catch {
      // daemon jeszcze wstaje
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error("daemon Paseo nie odpowiada na 127.0.0.1:6767 po 2 minutach");
}

/** Żywy proces Claude o tej nazwie w rejestrze sesji (~/.claude/sessions/<pid>.json). */
function claudeProcessAlive() {
  const dir = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(home, ".claude"), "sessions");
  if (!existsSync(dir)) return false;
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".json")) continue;
    try {
      const entry = JSON.parse(readFileSync(path.join(dir, file), "utf8"));
      if (entry.name !== name) continue;
      process.kill(Number(entry.pid), 0);
      return true;
    } catch {
      // wpis uszkodzony albo proces nie żyje
    }
  }
  return false;
}

const scopeText =
  scope === "cluster"
    ? "Jesteś supervisorem klastra (VPS): zarządzasz sesjami na wszystkich hostach."
    : `Jesteś lokalnym supervisorem maszyny ${os.hostname()}: tylko ta maszyna (daemon Paseo, aktualizacje forka, diagnostyka systemu), na polecenie właściciela albo supervisora z VPS. Sesjami w klastrze zarządza supervisor na VPS.`;

await waitForDaemon();
const agents = JSON.parse(paseo(["ls", "--label", "role=supervisor", "--json"]));
const agent = agents[0];

if (!agent) {
  console.log(`${name}: brak sesji, zakładam w ${cwd}`);
  paseo([
    "run", "--no-wait", "--provider", "claude", "--model", "opus", "--thinking", "medium",
    "--mode", "bypassPermissions", "--cwd", cwd, "--title", name,
    "--label", "role=supervisor", "--label", `supervisor-scope=${scope}`,
    "--env", `PASEO_CLAUDE_SESSION_NAME=${name}`,
    `${scopeText} Rola: skill paseo-supervisor (doklejany przez plugin supervisor-rola). Właściciel rozmawia z Tobą przez Paseo i Remote Control. Nic nie uruchamiaj, dopóki właściciel nie poprosi. Odpowiedz jednym zdaniem, że jesteś gotowa.`,
  ]);
} else if (!claudeProcessAlive()) {
  // Po starcie daemona Paseo pokazuje sesję jako idle, ale proces Claude rusza dopiero przy wiadomości.
  console.log(`${name}: ${agent.id} (${agent.status}) bez procesu Claude, budzę`);
  paseo([
    "send", "--no-wait", agent.id,
    `Daemon Paseo wystartował ponownie. ${scopeText} Nic nie uruchamiaj bez polecenia. Odpowiedz jednym zdaniem.`,
  ]);
} else {
  console.log(`${name}: ${agent.id} działa (${agent.status})`);
}
