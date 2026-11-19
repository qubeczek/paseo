#!/usr/bin/env node
// Trwały proces pośredni („hold”) dla jednej sesji Claude, żeby sesja przeżyła restart daemona Paseo.
//
// Uruchamiany przez daemon (hold-client.ts) poza jego cgroup (systemd-run --user --scope). Startuje
// proces Claude z rurami stdio i trzyma je, a daemon rozmawia z nim przez dwa gniazda unix:
//   <dir>/<id>.sock — dane: bajty od klienta → stdin Claude, stdout Claude → klient;
//   <dir>/<id>.ctl  — sterowanie, linie JSON: od klienta {"op":"signal","signal"} / {"op":"end-stdin"};
//                     do klienta {"event":"hello"|"stderr"|"exit", ...}.
// Rozmowa z Claude to linie JSON (stream-json), więc oba kierunki przechodzą tylko pełnymi liniami:
// gdy daemon zniknie w połowie linii, nowy klient nie dostanie uciętego JSON-a. Wyjście Claude bez
// podłączonego klienta czeka w kolejce i trafia do następnego klienta. Rozłączenie klienta NIE zamyka
// stdin Claude — robi to tylko jawne {"op":"end-stdin"}. Po wyjściu Claude hold czeka GRACE_MS, żeby
// klient zdążył odebrać resztę wyjścia i informację o końcu, potem sprząta pliki i kończy się.
//
// Użycie: node claude-hold.mjs <dir> <id> <specFile> [sockDir]
//   sockDir: katalog gniazd (krótka ścieżka — limit 108 znaków dla gniazd unix); domyślnie <dir>.
//   specFile: JSON {command, args, cwd, env}; plik jest usuwany zaraz po odczycie (zawiera env).

import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";

const GRACE_MS = 120_000;
const MAX_QUEUE_BYTES = 256 * 1024 * 1024;

const [dir, id, specFile, sockDirArg] = process.argv.slice(2);
const sockDir = sockDirArg || dir;
if (!dir || !id || !specFile) {
  console.error("usage: claude-hold.mjs <dir> <id> <specFile>");
  process.exit(2);
}
const spec = JSON.parse(fs.readFileSync(specFile, "utf8"));
fs.rmSync(specFile, { force: true });

const dataPath = path.join(sockDir, `${id}.sock`);
const ctlPath = path.join(sockDir, `${id}.ctl`);
const metaPath = path.join(dir, `${id}.json`);
const logPath = path.join(dir, `${id}.log`);
const log = fs.createWriteStream(logPath, { flags: "a", mode: 0o600 });
function note(message) {
  log.write(`${new Date().toISOString()} ${message}\n`);
}

const child = spawn(spec.command, spec.args, {
  cwd: spec.cwd,
  env: spec.env,
  stdio: ["pipe", "pipe", "pipe"],
});
const meta = {
  holdPid: process.pid,
  childPid: child.pid ?? null,
  startedAt: new Date().toISOString(),
  args: spec.args,
  exit: null,
};
function writeMeta() {
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), { mode: 0o600 });
}
writeMeta();
note(`claude pid=${child.pid} start`);

// --- wyjście Claude → klient danych, pełnymi liniami ---
let dataClient = null;
let outPartial = "";
let queue = [];
let queueBytes = 0;
function deliver(line) {
  if (dataClient && !dataClient.destroyed) {
    dataClient.write(line);
    return;
  }
  queue.push(line);
  queueBytes += Buffer.byteLength(line);
  while (queueBytes > MAX_QUEUE_BYTES && queue.length > 1) {
    queueBytes -= Buffer.byteLength(queue.shift());
    note("kolejka wyjścia przepełniona, odrzucam najstarszą linię");
  }
}
child.stdout.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
  outPartial += chunk;
  let index;
  while ((index = outPartial.indexOf("\n")) >= 0) {
    deliver(outPartial.slice(0, index + 1));
    outPartial = outPartial.slice(index + 1);
  }
});

// --- sterowanie ---
const ctlClients = new Set();
function broadcast(event) {
  const line = `${JSON.stringify(event)}\n`;
  for (const client of ctlClients) if (!client.destroyed) client.write(line);
}
child.stderr.setEncoding("utf8");
child.stderr.on("data", (data) => {
  log.write(data);
  broadcast({ event: "stderr", data });
});

let exited = false;
child.on("exit", (code, signal) => {
  exited = true;
  if (outPartial) deliver(outPartial);
  outPartial = "";
  meta.exit = { code, signal, at: new Date().toISOString() };
  writeMeta();
  note(`claude exit code=${code} signal=${signal}`);
  broadcast({ event: "exit", code, signal });
  setTimeout(shutdown, GRACE_MS).unref();
  // Bez klienta nie ma komu oddać reszty — nie trzymamy procesu dłużej niż trzeba.
  if (!dataClient && ctlClients.size === 0 && queue.length === 0) shutdown();
});
child.on("error", (error) => {
  note(`claude spawn error: ${error.message}`);
  meta.exit = { code: null, signal: null, error: error.message, at: new Date().toISOString() };
  writeMeta();
  broadcast({ event: "exit", code: null, signal: null, error: error.message });
  setTimeout(shutdown, 5_000).unref();
});

/** Po wyjściu Claude i rozłączeniu wszystkich klientów nie ma na kogo czekać. */
function shutdownIfAbandoned() {
  if (exited && !dataClient && ctlClients.size === 0) setTimeout(shutdown, 2_000).unref();
}

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const p of [dataPath, ctlPath]) fs.rmSync(p, { force: true });
  note("hold koniec");
  log.end(() => process.exit(0));
}

function listen(socketPath, onConnection) {
  fs.rmSync(socketPath, { force: true });
  const server = net.createServer(onConnection);
  server.on("error", (error) => {
    // Bez gniazda daemon nie podłączy się do sesji — kończymy, żeby nie zostawić sieroty.
    note(`gniazdo ${socketPath}: ${error.message}`);
    if (!exited) child.kill("SIGTERM");
  });
  server.listen(socketPath, () => fs.chmodSync(socketPath, 0o600));
  return server;
}

listen(dataPath, (socket) => {
  // Nowy klient zastępuje poprzedniego (np. daemon wrócił, zanim stary socket się zamknął).
  if (dataClient && !dataClient.destroyed) dataClient.destroy();
  dataClient = socket;
  note("klient danych podłączony");
  for (const line of queue) socket.write(line);
  queue = [];
  queueBytes = 0;
  let inPartial = "";
  socket.setEncoding("utf8");
  socket.on("data", (chunk) => {
    inPartial += chunk;
    const end = inPartial.lastIndexOf("\n");
    if (end < 0) return;
    if (!exited && child.stdin.writable) child.stdin.write(inPartial.slice(0, end + 1));
    inPartial = inPartial.slice(end + 1);
  });
  socket.on("close", () => {
    if (dataClient === socket) dataClient = null;
    note("klient danych odłączony");
    shutdownIfAbandoned();
  });
  socket.on("error", () => {});
});

listen(ctlPath, (socket) => {
  ctlClients.add(socket);
  socket.write(`${JSON.stringify({ event: "hello", childPid: meta.childPid, exit: meta.exit })}\n`);
  let partial = "";
  socket.setEncoding("utf8");
  socket.on("data", (chunk) => {
    partial += chunk;
    let index;
    while ((index = partial.indexOf("\n")) >= 0) {
      const line = partial.slice(0, index);
      partial = partial.slice(index + 1);
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      if (message.op === "signal" && !exited) {
        note(`sygnał ${message.signal} od klienta`);
        child.kill(message.signal ?? "SIGTERM");
      } else if (message.op === "end-stdin" && !exited) {
        note("koniec stdin od klienta");
        child.stdin.end();
      }
    }
  });
  socket.on("close", () => {
    ctlClients.delete(socket);
    shutdownIfAbandoned();
  });
  socket.on("error", () => {});
});

process.on("SIGHUP", () => {});
process.on("SIGTERM", () => {
  // Zatrzymanie holda (np. sprzątanie sierot) kończy też sesję.
  note("SIGTERM dla holda — kończę Claude");
  if (!exited) child.kill("SIGTERM");
});
