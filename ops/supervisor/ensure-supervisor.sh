#!/usr/bin/env bash
# Pilnuje jednej sesji "supervisor" (projekt ~/projects/paseo) po każdym starcie daemona Paseo.
# Brak sesji z etykietą role=supervisor -> zakłada ją; sesja zamknięta (closed) -> budzi ją jedną wiadomością,
# co uruchamia proces Claude i rejestruje Remote Control. Odpalany przez paseo-supervisor.service.
set -euo pipefail
export PASEO_HOME="$HOME/.paseo"
PASEO_PASSWORD="$(cat "$HOME/.paseo/web-password.txt")"
export PASEO_PASSWORD
PASEO="$HOME/projects/paseo/src/packages/cli/bin/paseo"
CWD="$HOME/projects/paseo"

# Żywy proces Claude z nazwą "supervisor" w rejestrze sesji (~/.claude/sessions/<pid>.json).
supervisor_process_alive() {
  python3 - "$HOME/.claude/sessions" <<'PY'
import json, os, sys, glob
for path in glob.glob(os.path.join(sys.argv[1], "*.json")):
    try:
        entry = json.load(open(path))
        if entry.get("name") == "supervisor":
            os.kill(int(entry["pid"]), 0)
            sys.exit(0)
    except (OSError, ValueError, KeyError, TypeError):
        continue
sys.exit(1)
PY
}

for _ in $(seq 1 60); do
  curl -sf http://127.0.0.1:6767/api/health >/dev/null && break
  sleep 2
done

read -r id status < <("$PASEO" ls --label role=supervisor --json | python3 -c '
import json, sys
agents = json.load(sys.stdin)
print(agents[0]["id"], agents[0]["status"]) if agents else print("- -")
')

if [ "$id" = "-" ]; then
  echo "supervisor: brak sesji, zakładam"
  "$PASEO" run --no-wait --provider claude --model opus --thinking medium --mode bypassPermissions \
    --cwd "$CWD" --title supervisor --label role=supervisor \
    --env PASEO_CLAUDE_SESSION_NAME=supervisor \
    "Jesteś sesją supervisor farmy sesji Paseo na tym hoście. Przeczytaj START.md w tym katalogu. Właściciel rozmawia z Tobą przez Paseo i Remote Control, żeby sterować sesjami agentów na tej i innych maszynach (CLI: src/packages/cli/bin/paseo, narzędzia MCP Paseo). Nic nie uruchamiaj, dopóki właściciel nie poprosi. Odpowiedz jednym zdaniem, że jesteś gotowa."
elif ! supervisor_process_alive; then
  # Po starcie daemona Paseo pokazuje sesję jako idle, ale proces Claude rusza dopiero przy wiadomości.
  echo "supervisor: $id ($status) bez procesu Claude, budzę"
  "$PASEO" send --no-wait "$id" "Daemon Paseo wystartował ponownie. Kontynuuj jako supervisor; nic nie uruchamiaj bez polecenia właściciela. Odpowiedz jednym zdaniem."
else
  echo "supervisor: $id działa ($status)"
fi
