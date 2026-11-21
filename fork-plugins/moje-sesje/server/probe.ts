// Same source as bmadx-pm: the welthix-style harness probe `story_probe.py --all` in each project root.
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";

const STORY_PROBE = ".claude/scripts/harness/story_probe.py";
const CACHE_MS = 60_000;
const cache = new Map<string, { at: number; names: string[] }>();

function run(cmd: string, args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { cwd, timeout: 30_000, maxBuffer: 8 << 20, encoding: "utf8" }, (error, stdout) =>
      error ? reject(error) : resolve(stdout),
    );
  });
}

async function python(args: string[], cwd: string): Promise<string> {
  const candidates = process.platform === "win32" ? ["python", "py", "python3"] : ["python3", "python"];
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

export async function questionsIn(root: string): Promise<string[]> {
  const hit = cache.get(root);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.names;
  let names: string[] = [];
  const probe = path.join(root, STORY_PROBE);
  if (await fs.access(probe).then(() => true, () => false)) {
    try {
      const records = JSON.parse(await python([STORY_PROBE, "--all"], root)) as {
        verdict?: string;
        session?: { name?: string } | null;
      }[];
      names = records
        .filter((r) => r.verdict?.startsWith("WAITING") && r.verdict !== "WAITING_MERGE_WINDOW" && r.session?.name)
        .map((r) => r.session!.name as string);
    } catch {
      names = [];
    }
  }
  cache.set(root, { at: Date.now(), names });
  return names;
}
