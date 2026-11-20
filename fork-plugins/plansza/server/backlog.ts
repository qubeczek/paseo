// Read-only view of a BMAD project's backlog: the same data bmadx-pm shows for "status kolejki".
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Backlog } from "../shared/contracts";

const ARTIFACTS = "docs/implementation-artifacts";
const BMAD_CONFIG = "_bmad/bmm/config.yaml";
// welthix: harness/pm_queue.py; aquila: scripts/pm/pm-queue.py (same --json contract)
const PM_QUEUES = [".claude/scripts/harness/pm_queue.py", ".claude/scripts/pm/pm-queue.py"];
const AQUILA_PM_STATE = ".claude/state/pm";
const CONFIG = ".claude/scripts/harness/config.py";
const CACHE_MS = 60_000;

const cache = new Map<string, { at: number; value: Backlog | null }>();

function run(cmd: string, args: string[], cwd: string, timeout = 45_000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { cwd, timeout, maxBuffer: 8 << 20, encoding: "utf8" }, (error, stdout) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(stdout);
    });
  });
}

async function python(args: string[], cwd: string): Promise<string> {
  const candidates =
    process.platform === "win32" ? ["python", "py", "python3"] : ["python3", "python"];
  let last: unknown;
  for (const cmd of candidates) {
    try {
      return await run(cmd, args, cwd);
    } catch (error) {
      last = error;
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  throw last;
}

async function exists(file: string): Promise<boolean> {
  return fs.access(file).then(
    () => true,
    () => false,
  );
}

async function readText(file: string): Promise<string | null> {
  return fs.readFile(file, "utf8").catch(() => null);
}

/** `  <key>: <status>` lines under development_status, without epics and retrospectives. */
export function parseSprintStatus(text: string): Map<string, string> {
  const result = new Map<string, string>();
  let inside = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^development_status:\s*$/.test(line)) {
      inside = true;
      continue;
    }
    if (!inside) continue;
    if (/^\S/.test(line)) break;
    const match = /^\s+([0-9a-z][\w.-]*):\s*([\w-]+)/i.exec(line);
    if (!match) continue;
    const [, key, status] = match;
    if (key.startsWith("epic-") || key.includes("retrospective")) continue;
    result.set(key, status);
  }
  return result;
}

/** "0-206-partial-collection-writes" → "0-206". */
export function shortKey(key: string): string {
  const match = /^(\d+[a-z]?-\d+[a-z]?)/i.exec(key);
  return match ? match[1] : key;
}

/** `### Story 0.206: Title` → "0-206" → "Title". */
export function parseEpicTitles(text: string): Map<string, string> {
  const titles = new Map<string, string>();
  for (const match of text.matchAll(/^###\s+Story\s+(\d+[a-z]?)\.(\d+[a-z]?):\s*(.+)$/gim)) {
    titles.set(`${match[1]}-${match[2]}`.toLowerCase(), match[3].trim());
  }
  return titles;
}

/** Phase rows `| id | name | status | … |` of a flow file. */
export function parsePhases(text: string): { id: string; name: string; status: string }[] {
  const phases: { id: string; name: string; status: string }[] = [];
  for (const line of text.split(/\r?\n/)) {
    const cells = line.split("|").map((cell) => cell.trim());
    if (cells.length < 5 || !/^\d[\w.]*$/.test(cells[1])) continue;
    const status = /^(DONE|IN_PROGRESS|TODO|SKIPPED|BLOCKED|N\/A)/i.exec(cells[3]);
    if (!status) continue;
    phases.push({ id: cells[1], name: cells[2], status: status[1].toUpperCase() });
  }
  return phases;
}

function currentPhase(phases: ReturnType<typeof parsePhases>) {
  return (
    phases.find((phase) => phase.status === "IN_PROGRESS") ??
    phases.find((phase) => phase.status === "TODO") ??
    null
  );
}

async function harnessConfig(root: string): Promise<Record<string, string>> {
  const keys = [
    "worktree_root",
    "flow_file_path",
    "state_dir",
    "epics",
    "sprint_status",
    "implementation_artifacts",
  ];
  const values: Record<string, string> = {};
  if (!(await exists(path.join(root, CONFIG)))) return values;
  await Promise.all(
    keys.map(async (key) => {
      try {
        values[key] = (await python([CONFIG, "get", key], root)).trim();
      } catch {
        // Missing key: the defaults below apply.
      }
    }),
  );
  return values;
}

function expandHome(value: string): string {
  return value.startsWith("~") ? path.join(os.homedir(), value.slice(1)) : value;
}

async function readFlow(root: string, config: Record<string, string>, key: string, short: string) {
  const relative = (
    config.flow_file_path ||
    `${config.implementation_artifacts || ARTIFACTS}/{story_key}/{story_short}-flow.md`
  )
    .replaceAll("{story_key}", key)
    .replaceAll("{story_short}", short);
  const worktreeRoot = path.resolve(
    root,
    expandHome(config.worktree_root || `../${path.basename(root)}-wt`),
  );
  // A story in progress lives in its worktree (welthix: `<short>`, aquila: `story-<short>`);
  // after the merge its flow file is on the main checkout.
  for (const base of [
    path.join(worktreeRoot, short),
    path.join(worktreeRoot, `story-${short}`),
    root,
  ]) {
    const text = await readText(path.join(base, relative));
    if (text) return parsePhases(text);
  }
  return null;
}

/** Aquila keeps the PM card per machine in `.claude/state/pm/<symbol>/run-card.md`; take the newest one. */
async function newestRunCard(root: string): Promise<string | null> {
  const dir = path.join(root, AQUILA_PM_STATE);
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  let best: { file: string; mtime: number } | null = null;
  for (const entry of entries.filter((e) => e.isDirectory())) {
    const file = path.join(dir, entry.name, "run-card.md");
    const stat = await fs.stat(file).catch(() => null);
    if (stat && (!best || stat.mtimeMs > best.mtime)) best = { file, mtime: stat.mtimeMs };
  }
  return best?.file ?? null;
}

async function readPmLine(root: string, config: Record<string, string>): Promise<string | null> {
  const card = config.state_dir
    ? path.join(expandHome(config.state_dir), "run-card.md")
    : await newestRunCard(root);
  if (!card) return null;
  const text = await readText(card);
  const match = text && /^Aktualizacja:\s*(.+)$/m.exec(text);
  if (!match) return null;
  const line = match[1];
  const stamp = /^\S+/.exec(line)?.[0] ?? "";
  const mode = /tryb\s+([A-ZĄĆĘŁŃÓŚŹŻ]+)/.exec(line)?.[1];
  const slots = /sloty\s+(\d+\/\d+)/.exec(line)?.[1];
  return [stamp, mode && `tryb ${mode}`, slots && `sloty ${slots}`].filter(Boolean).join(" · ");
}

/**
 * Story keys from `<worktree_root>/*\/_worktree.json` markers. Aquila marks a story in progress this way and keeps
 * its sprint-status entry at `backlog` until the merge.
 */
async function worktreeStories(root: string, config: Record<string, string>): Promise<string[]> {
  const worktreeRoot = path.resolve(
    root,
    expandHome(config.worktree_root || `../${path.basename(root)}-wt`),
  );
  const entries = await fs.readdir(worktreeRoot, { withFileTypes: true }).catch(() => []);
  const keys = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const text = await readText(path.join(worktreeRoot, entry.name, "_worktree.json"));
        if (!text) return null;
        try {
          const marker = JSON.parse(text.replace(/^﻿/, "")) as { story_key?: unknown };
          return typeof marker.story_key === "string" ? marker.story_key : null;
        } catch {
          return null;
        }
      }),
  );
  return keys.filter((key): key is string => key !== null);
}

/** Without a PM queue: `in-progress` in the sprint file, plus stories with a live worktree marker. */
async function inProgressFromFiles(
  root: string,
  config: Record<string, string>,
  statuses: Map<string, string>,
): Promise<string[]> {
  const fromSprint = [...statuses]
    .filter(([, status]) => status === "in-progress")
    .map(([key]) => key);
  const fromWorktrees = (await worktreeStories(root, config)).filter(
    (key) => statuses.has(key) && statuses.get(key) !== "done",
  );
  return [...new Set([...fromSprint, ...fromWorktrees])];
}

interface PmQueue {
  in_progress?: string[];
  queue?: {
    key: string;
    short?: string;
    admissible?: boolean;
    reasons?: string[];
    feature?: string;
  }[];
}

/** The project's PM queue script (`--json`), if it has one; errors go to the backlog card. */
async function readPmQueue(root: string, errors: string[]): Promise<PmQueue | null> {
  for (const script of PM_QUEUES) {
    if (!(await exists(path.join(root, script)))) continue;
    try {
      return JSON.parse(await python([script, "--json"], root)) as PmQueue;
    } catch (error) {
      errors.push(
        `pm_queue: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`,
      );
      return null;
    }
  }
  return null;
}

/** `implementation_artifacts: "{project-root}/docs/..."` (or `planning_artifacts`) in BMAD's config. */
async function bmadArtifacts(
  root: string,
  key: "implementation_artifacts" | "planning_artifacts" = "implementation_artifacts",
): Promise<string | null> {
  const text = await readText(path.join(root, BMAD_CONFIG));
  if (!text) return null;
  const value = (name: string) =>
    new RegExp(`^${name}:\\s*["']?([^"'\\r\\n#]+?)["']?\\s*(?:#.*)?$`, "m").exec(text)?.[1] ?? null;
  const artifacts = value(key);
  if (!artifacts) return null;
  const resolved = artifacts
    .replaceAll(
      "{output_folder}",
      (value("output_folder") ?? "docs").replace(/^\{project-root\}[\\/]?/, ""),
    )
    .replace(/^\{project-root\}[\\/]?/, "");
  return resolved.includes("{") ? null : resolved;
}

/** The first sprint-status.yaml found, and the paths tried (for the "not found" message). */
async function readSprint(root: string, config: Record<string, string>) {
  const tried = [
    ...new Set(
      [
        config.sprint_status,
        config.implementation_artifacts &&
          path.join(config.implementation_artifacts, "sprint-status.yaml"),
        path.join(ARTIFACTS, "sprint-status.yaml"),
      ].filter((file): file is string => !!file),
    ),
  ];
  for (const file of tried) {
    const text = await readText(path.resolve(root, expandHome(file)));
    if (text !== null) return { text, tried };
  }
  return { text: null, tried };
}

async function readBacklog(root: string): Promise<Backlog | null> {
  const config = await harnessConfig(root);
  config.implementation_artifacts ||= (await bmadArtifacts(root)) ?? "";
  const { text: sprintText, tried } = await readSprint(root, config);
  if (sprintText === null) {
    // A BMAD project without a sprint file says so; any other project has no backlog at all.
    const bmad =
      (await exists(path.join(root, BMAD_CONFIG))) || (await exists(path.join(root, CONFIG)));
    if (!bmad) return null;
    return {
      root,
      counts: {},
      inProgress: [],
      queue: null,
      pm: null,
      error: `Nie znalazłem sprint-status.yaml (szukałem: ${tried.join(", ")})`,
      readAt: new Date().toISOString(),
    };
  }
  const statuses = parseSprintStatus(sprintText);
  const counts: Record<string, number> = {};
  for (const status of statuses.values()) counts[status] = (counts[status] ?? 0) + 1;

  const errors: string[] = [];
  const planning = (await bmadArtifacts(root, "planning_artifacts")) ?? "docs/planning-artifacts";
  const epicsText = await readText(path.join(root, config.epics || `${planning}/epics.md`));
  const titles = epicsText ? parseEpicTitles(epicsText) : new Map<string, string>();
  const title = (short: string) => titles.get(short.toLowerCase()) ?? null;

  const pm = await readPmQueue(root, errors);

  const inProgressKeys = pm?.in_progress ?? (await inProgressFromFiles(root, config, statuses));
  const inProgress = await Promise.all(
    inProgressKeys.map(async (key) => {
      const short = shortKey(key);
      const phases = await readFlow(root, config, key, short);
      return {
        key,
        short,
        title: title(short),
        phase: phases ? currentPhase(phases) : null,
        done: phases
          ? phases.filter((phase) => phase.status === "DONE" || phase.status === "SKIPPED").length
          : 0,
        total: phases ? phases.length : 0,
      };
    }),
  );

  const queue = pm?.queue
    ? pm.queue.map((item) => {
        const short = item.short || shortKey(item.key);
        return {
          short,
          title: title(short),
          admissible: item.admissible === true,
          reasons: item.reasons ?? [],
          feature: item.feature ?? "",
        };
      })
    : null;

  return {
    root,
    counts,
    inProgress,
    queue,
    pm: await readPmLine(root, config),
    error: errors.length > 0 ? errors.join("; ") : null,
    readAt: new Date().toISOString(),
  };
}

export async function backlogFor(root: string): Promise<Backlog | null> {
  const hit = cache.get(root);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  const value = await readBacklog(root).catch(
    (error): Backlog => ({
      root,
      counts: {},
      inProgress: [],
      queue: null,
      pm: null,
      error: error instanceof Error ? error.message : String(error),
      readAt: new Date().toISOString(),
    }),
  );
  cache.set(root, { at: Date.now(), value });
  return value;
}
