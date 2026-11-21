#!/usr/bin/env bash
# VPS: odpalany przez paseo-supervisor.service po starcie daemona. Cała logika w ensure-supervisor.mjs
# (ta sama na Windows); tu tylko domyślne wartości VPS: ~/projects/paseo, nazwa "supervisor", zasięg klaster.
set -euo pipefail
exec node "$(dirname "$(readlink -f "$0")")/ensure-supervisor.mjs" --cwd "$HOME/projects/paseo" --name supervisor --scope cluster
