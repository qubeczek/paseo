/* oxlint-disable paseo/no-sync-io -- the SDK spawn hook (spawnClaudeCodeProcess) is synchronous, so choosing attach vs spawn must be too; each call touches a few tiny files once per Claude process launch. */
import { spawn as spawnChild, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";

/**
 * Prototype: Claude sessions that survive a daemon restart (PASEO_CLAUDE_HOLD=1, Linux only).
 *
 * Instead of spawning Claude as its own child, the daemon starts a small persistent "hold" process
 * (scripts/claude-hold.mjs) outside its cgroup. The hold owns Claude's stdio and exposes it on unix
 * sockets; this module returns a ChildProcess-shaped adapter over those sockets to the Agent SDK.
 * On daemon shutdown the adapter only detaches, so Claude keeps running (its turn, background
 * shells, Monitors, Remote Control). When the next daemon opens the same Claude session, the
 * adapter attaches to the live hold instead of spawning; the SDK's `initialize` is answered by the
 * running Claude, which keeps its conversation.
 */

const HELD = Symbol.for("paseo.claudeHeldProcess");
let detaching = false;

export function claudeHoldEnabled(): boolean {
  return process.platform === "linux" && process.env.PASEO_CLAUDE_HOLD === "1";
}

/** Set on daemon shutdown: closing a held session then detaches instead of ending Claude. */
export function setClaudeHoldDetaching(value: boolean): void {
  detaching = value;
}

export function isHeldClaudeProcess(child: unknown): boolean {
  return typeof child === "object" && child !== null && HELD in child;
}

export function isClaudeHoldDetaching(): boolean {
  return detaching;
}

export function claudeHoldDir(): string {
  const home = process.env.PASEO_HOME ?? path.join(os.homedir(), ".paseo");
  return path.join(home, "holds");
}

/**
 * Sockets live under a short runtime path: a unix socket path is limited to 108 bytes, which a
 * PASEO_HOME deep in the filesystem would exceed. One directory per daemon home.
 */
export function claudeHoldSocketDir(): string {
  const base = process.env.XDG_RUNTIME_DIR ?? os.tmpdir();
  const key = createHash("sha256").update(claudeHoldDir()).digest("hex").slice(0, 10);
  return path.join(base, "paseo-hold", key);
}

function holdScriptPath(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i += 1) {
    for (const candidate of [
      path.join(dir, "scripts", "claude-hold.mjs"),
      path.join(dir, "dist", "scripts", "claude-hold.mjs"),
    ]) {
      if (fs.existsSync(candidate)) return candidate;
    }
    dir = path.dirname(dir);
  }
  throw new Error("claude-hold.mjs not found");
}

interface HoldMeta {
  holdPid: number;
  childPid: number | null;
  exit: unknown;
}

function readMeta(holdId: string): HoldMeta | null {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(claudeHoldDir(), `${holdId}.json`), "utf8"),
    ) as HoldMeta;
  } catch {
    return null;
  }
}

function alive(pid: number | null | undefined): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Claude session id of a running Claude process, from its registry entry. */
function registrySessionId(configDir: string, pid: number): string | null {
  try {
    const entry = JSON.parse(
      fs.readFileSync(path.join(configDir, "sessions", `${pid}.json`), "utf8"),
    ) as { sessionId?: unknown };
    return typeof entry.sessionId === "string" ? entry.sessionId : null;
  } catch {
    return null;
  }
}

function resumeArg(args: readonly string[]): string | null {
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!;
    if (arg === "--resume") return args[i + 1] ?? null;
    if (arg.startsWith("--resume=")) return arg.slice("--resume=".length);
  }
  return null;
}

export interface HeldSpawnInput {
  holdId: string;
  command: string;
  args: string[];
  cwd: string | undefined;
  env: NodeJS.ProcessEnv;
  claudeConfigDir: string;
  log: (message: string, extra?: Record<string, unknown>) => void;
}

/**
 * Attach to the live hold of this agent when it runs the Claude session the SDK asks to resume;
 * otherwise end any stale hold and start a new one.
 */
export function spawnHeldClaude(input: HeldSpawnInput): ChildProcess {
  const dir = claudeHoldDir();
  const sockDir = claudeHoldSocketDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.mkdirSync(sockDir, { recursive: true, mode: 0o700 });
  const meta = readMeta(input.holdId);
  const wanted = resumeArg(input.args);
  if (meta && alive(meta.holdPid) && alive(meta.childPid) && !meta.exit) {
    const running = registrySessionId(input.claudeConfigDir, meta.childPid!);
    if (wanted && running === wanted) {
      input.log("claude hold: attaching to running session", {
        holdId: input.holdId,
        childPid: meta.childPid,
        sessionId: running,
      });
      return createHeldProcess(input.holdId, meta.childPid!);
    }
    input.log("claude hold: replacing hold of another session", {
      holdId: input.holdId,
      running,
      wanted,
    });
    try {
      process.kill(meta.holdPid, "SIGTERM");
    } catch {
      /* already gone */
    }
  }

  const specFile = path.join(dir, `${input.holdId}.spec.${process.pid}.${Date.now()}`);
  fs.writeFileSync(
    specFile,
    JSON.stringify({ command: input.command, args: input.args, cwd: input.cwd, env: input.env }),
    { mode: 0o600 },
  );
  fs.rmSync(path.join(dir, `${input.holdId}.json`), { force: true });
  for (const suffix of [".sock", ".ctl"]) {
    fs.rmSync(path.join(sockDir, `${input.holdId}${suffix}`), { force: true });
  }
  const script = holdScriptPath();
  const unit = `paseo-hold-${input.holdId.slice(0, 8)}-${Date.now().toString(36)}`;
  const useScope =
    fs.existsSync("/usr/bin/systemd-run") && process.env.PASEO_CLAUDE_HOLD_SCOPE !== "0";
  const command = useScope ? "/usr/bin/systemd-run" : process.execPath;
  const args = useScope
    ? [
        "--user",
        "--scope",
        "--quiet",
        "--collect",
        `--unit=${unit}`,
        process.execPath,
        script,
        dir,
        input.holdId,
        specFile,
        sockDir,
      ]
    : [script, dir, input.holdId, specFile, sockDir];
  const launcher = spawnChild(command, args, { detached: true, stdio: "ignore", env: process.env });
  launcher.on("exit", (code, signal) => {
    // With --scope systemd-run stays as the hold itself, so an early exit means the hold ended.
    if (code !== 0)
      input.log("claude hold: launcher exited", { holdId: input.holdId, code, signal });
  });
  launcher.unref();
  input.log("claude hold: started", { holdId: input.holdId, unit: useScope ? unit : null });
  return createHeldProcess(input.holdId, null);
}

/** ChildProcess-shaped adapter over a hold's sockets. */
function createHeldProcess(holdId: string, knownPid: number | null): ChildProcess {
  const dir = claudeHoldSocketDir();
  const emitter = new EventEmitter() as EventEmitter & Record<string | symbol, unknown>;
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let dataSocket: net.Socket | null = null;
  let ctlSocket: net.Socket | null = null;
  let exited = false;
  let stdinEnded = false;

  const state = {
    pid: knownPid ?? undefined,
    exitCode: null as number | null,
    signalCode: null as NodeJS.Signals | null,
    killed: false,
  };

  function finish(code: number | null, signal: NodeJS.Signals | null) {
    if (exited) return;
    exited = true;
    state.exitCode = code;
    state.signalCode = signal;
    stdout.end();
    stderr.end();
    // Released sockets let the hold finish its cleanup.
    dataSocket?.destroy();
    ctlSocket?.destroy();
    emitter.emit("exit", code, signal);
    emitter.emit("close", code, signal);
  }

  function sendCtl(message: Record<string, unknown>) {
    ctlSocket?.write(`${JSON.stringify(message)}\n`);
  }

  function connect(attempt: number) {
    const ctl = net.connect(path.join(dir, `${holdId}.ctl`));
    ctl.once("connect", () => {
      ctlSocket = ctl;
      const data = net.connect(path.join(dir, `${holdId}.sock`));
      dataSocket = data;
      data.pipe(stdout, { end: false });
      stdin.pipe(data, { end: false });
      data.on("error", () => {});
      if (stdinEnded && !detaching) sendCtl({ op: "end-stdin" });
    });
    ctl.once("error", () => {
      ctl.destroy();
      if (attempt < 100) {
        setTimeout(() => connect(attempt + 1), 100);
      } else {
        emitter.emit("error", new Error(`claude hold ${holdId} did not open its sockets`));
        finish(null, "SIGKILL");
      }
    });
    let partial = "";
    ctl.setEncoding("utf8");
    ctl.on("data", (chunk: string) => {
      partial += chunk;
      let index;
      while ((index = partial.indexOf("\n")) >= 0) {
        const line = partial.slice(0, index);
        partial = partial.slice(index + 1);
        let event: {
          event?: string;
          childPid?: number;
          data?: string;
          code?: number | null;
          signal?: NodeJS.Signals | null;
          exit?: { code: number | null; signal: NodeJS.Signals | null } | null;
        };
        try {
          event = JSON.parse(line);
        } catch {
          continue;
        }
        if (event.event === "hello") {
          state.pid = event.childPid ?? state.pid;
          if (event.exit) finish(event.exit.code, event.exit.signal);
        } else if (event.event === "stderr" && event.data) {
          stderr.write(event.data);
        } else if (event.event === "exit") {
          // Let the data socket drain the last lines before reporting the exit.
          setTimeout(() => finish(event.code ?? null, event.signal ?? null), 200);
        }
      }
    });
    ctl.on("close", () => {
      // The hold vanished without reporting an exit (killed, crashed): Claude is gone with it
      // unless we are detaching on purpose.
      if (ctlSocket === ctl && !detaching) setTimeout(() => finish(null, "SIGKILL"), 500);
    });
  }
  connect(0);

  stdin.on("finish", () => {
    stdinEnded = true;
    if (!detaching) sendCtl({ op: "end-stdin" });
  });

  Object.assign(emitter, {
    [HELD]: true,
    stdin,
    stdout,
    stderr,
    stdio: [stdin, stdout, stderr],
    get pid() {
      return state.pid;
    },
    get exitCode() {
      return state.exitCode;
    },
    get signalCode() {
      return state.signalCode;
    },
    get killed() {
      return state.killed;
    },
    kill(signal: NodeJS.Signals | number = "SIGTERM") {
      if (detaching) {
        // Daemon shutdown: leave Claude running and just drop our sockets.
        dataSocket?.destroy();
        ctlSocket?.destroy();
        finish(null, null);
        return true;
      }
      state.killed = true;
      sendCtl({ op: "signal", signal: typeof signal === "number" ? "SIGTERM" : signal });
      return true;
    },
    unref() {},
    ref() {},
  });
  return emitter as unknown as ChildProcess;
}
