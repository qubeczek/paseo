#!/usr/bin/env bash
# Jednorazowe wdrożenie przy restarcie daemona Paseo (2026-11-19), uruchamiać TYLKO za zgodą właściciela.
# Restart zamyka wszystkie sesje Paseo (w-pm, supervisor, sesje story); te, które miały trwającą turę,
# wracają same (agents.resumeOnStartup). To ostatni taki restart: od teraz sesje działają pod holdem.
#
# Co wdraża (dist zbudowany z forka qubeczek/paseo, gałąź claude-remote-control, do 58564f7c5):
#   - `paseo agent update --env/--unset-env`, import z --env dla zarchiwizowanych (91582ed95, 11bb557cb);
#   - prototyp sesji przeżywających restart (58564f7c5): PASEO_CLAUDE_HOLD=1 w unicie usługi;
#   - powiadomienia: push tylko gdy sesja czeka na zgodę lub stoi na błędzie ≥2 min (4c6d8234a);
#   - w-pm: nazwa Remote Control `w-pm` (zamiast błędnego `w-w-pm`) — poprawiana w rekordzie przy
#     zatrzymanym daemonie, bo działający daemon nadpisuje rekord swoją kopią z pamięci.
set -euo pipefail
UNIT="$HOME/.config/systemd/user/paseo-daemon.service"
WPM_RECORD=$(ls "$HOME"/.paseo/agents/*/28616505-*.json)

grep -q '^Environment=PASEO_CLAUDE_HOLD=1$' "$UNIT" ||
  sed -i 's|^Environment=PASEO_HOME=.*|&\nEnvironment=PASEO_CLAUDE_HOLD=1|' "$UNIT"
# Powiadomienia: tylko zgoda/błąd i dopiero gdy sesja czeka ≥2 min (4c6d8234a).
grep -q '^Environment=PASEO_NOTIFY_REASONS=' "$UNIT" ||
  sed -i 's|^Environment=PASEO_HOME=.*|&\nEnvironment=PASEO_NOTIFY_REASONS=permission,error\nEnvironment=PASEO_PUSH_DELAY_MS=120000|' "$UNIT"
systemctl --user daemon-reload

systemctl --user stop paseo-daemon
python3 - "$WPM_RECORD" <<'PY'
import json, os, sys
path = sys.argv[1]
record = json.load(open(path))
env = record.get("launchEnv") or {}
env["PASEO_CLAUDE_REMOTE_CONTROL_NAME"] = "w-pm"
record["launchEnv"] = env
tmp = path + ".tmp"
json.dump(record, open(tmp, "w"), indent=2)
os.replace(tmp, path)
print("w-pm launchEnv:", env)
PY
systemctl --user start paseo-daemon

for _ in $(seq 1 60); do curl -sf http://127.0.0.1:6767/api/health >/dev/null && break; sleep 2; done
systemctl --user show paseo-daemon -p ActiveState -p Environment
echo "OK: daemon wstał. Sprawdź: paseo ls; ls ~/.paseo/holds (nowe sesje mają hold)."
