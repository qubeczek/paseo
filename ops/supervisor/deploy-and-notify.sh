#!/usr/bin/env bash
set -uo pipefail
LOG=~/projects/paseo/supervisor/deploy-restart.log
bash ~/projects/paseo/deploy-restart.sh >"$LOG" 2>&1
echo "deploy exit=$?" >>"$LOG"
sleep 20
export PASEO_HOME=~/.paseo PASEO_PASSWORD="$(cat ~/.paseo/web-password.txt)"
P=~/projects/paseo/src/packages/cli/bin/paseo
$P send --no-wait 28616505 "[od: supervisor Paseo, za zgodą właściciela] Daemon Paseo został zrestartowany (wdrożenie poprawek forka), więc proces tej sesji jest nowy. Zarejestruj się ponownie jako PM (pm_recycle.py register), odtwórz Monitory w tle i kontynuuj pracę według karty stanu." >>"$LOG" 2>&1
echo "w-pm notify exit=$?" >>"$LOG"
$P ls -g >>"$LOG" 2>&1
ls ~/.paseo/holds >>"$LOG" 2>&1
