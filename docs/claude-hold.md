# Claude sessions that survive a daemon restart (prototype, fork only)

Off by default. Enable with `PASEO_CLAUDE_HOLD=1` in the daemon environment (Linux only).

## Why a restart ends sessions today

Three independent reasons, all of which must go:

1. `closeAllAgents` (bootstrap.ts) closes every agent on shutdown, which tree-kills Claude.
2. The service cgroup: with `KillMode=mixed` systemd kills whatever is left in it.
3. The daemon talks to Claude over the stdin/stdout pipes of an Agent SDK child process. A new
   daemon cannot pick up pipes owned by a dead one.

## Design

A persistent **hold** per Claude session (`packages/server/scripts/claude-hold.mjs`), started
outside the daemon's cgroup with `systemd-run --user --scope` (falls back to a detached process):

- The hold spawns Claude and owns its pipes. It exposes them on two unix sockets under
  `$XDG_RUNTIME_DIR/paseo-hold/<hash of PASEO_HOME>/`: `<agentId>.sock` (raw data) and
  `<agentId>.ctl` (JSON lines: `signal`, `end-stdin` in; `hello`, `stderr`, `exit` out). Sockets
  live under a short runtime path because a unix socket path is limited to 108 bytes.
- `$PASEO_HOME/holds/<agentId>.json` records the hold and Claude pids and the exit; `.log` keeps
  stderr and the hold's own events.
- Both directions pass whole lines only (stream-json is line-delimited), so a daemon that dies
  mid-line never leaves the next client with a truncated message. Claude's output with no client
  attached is queued (256 MB cap, oldest dropped) and replayed to the next client.
- A client disconnect never closes Claude's stdin; only an explicit `end-stdin` does.

On the daemon side, `hold-client.ts` plugs into `spawnClaudeCodeProcess` (query.ts) and returns a
ChildProcess-shaped adapter over the sockets, so the SDK and `ClaudeAgentSession` keep working
unchanged:

- **Spawn or attach.** When the agent's hold is alive and its Claude process runs the session the
  SDK asks to `--resume` (checked against `~/.claude/sessions/<pid>.json`), the adapter attaches.
  Otherwise it ends the stale hold and starts a new one. The SDK's `initialize` goes to the running
  Claude, which answers again and keeps its conversation (verified: same `session_id`, context kept).
- **Detach on shutdown.** bootstrap.ts calls `setClaudeHoldDetaching(true)` before `closeAllAgents`.
  The adapter then turns `kill()` and the end of stdin into dropping its sockets, and
  `ClaudeAgentSession.close()` skips the process-tree kill for held processes.
- **Normal close** (archive, idle cleanup, reload) sends `end-stdin`/`signal`, Claude exits, the
  adapter releases its sockets and the hold removes its files and exits.

## Verified (test daemon on a separate PASEO_HOME and port)

- A turn running a 60 s command; daemon restart in the middle: Claude keeps running in its own
  `paseo-hold-*.scope`, same pid. The next prompt attaches to it; the buffered result of the
  interrupted turn and the new answer both reach Paseo.
- Same with `agents.resumeOnStartup`: the resume prompt reattaches to the live process and the
  turn finishes with its real result.
- Archive ends Claude and the hold cleans up within seconds.

## Open edges

- `resumeOnStartup` still sends its resume prompt to a session whose turn is still running in the
  hold. Harmless (it queues as a follow-up), but it should be skipped when the attach found a live
  hold.
- A pending permission request at restart: the request was answered by the old daemon's
  `canUseTool`. After reattach the SDK has no record of it; Claude waits forever. Needs the hold to
  remember unanswered `control_request`s and replay them to the new client.
- Orphans: a hold whose agent was archived or deleted while the daemon was down keeps running.
  Startup should sweep `$PASEO_HOME/holds` and end holds of unknown or archived agents.
- Codex (`codex app-server`) is a separate process model and is not covered.
- Windows is not covered (unix sockets, systemd-run).
