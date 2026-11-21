# Paseo — uruchomienie na tym VPS (notatka startowa)

Cel właściciela: jedno miejsce (web + telefon) do uruchamiania sesji agentów (Claude Code, Codex…) na wielu
maszynach, ze statusem „kto na mnie czeka”, podglądem czatu i subagentów, własnymi pluginami/ekranami.
Praca w samej sesji NIE musi odbywać się w Paseo — wystarczy przejście do aplikacji Claude (Remote Control)
dla konkretnego wątku.

## Stan
- Źródła: `src/` (klon `github.com/getpaseo/paseo`, gałąź main). Zależności: `npm ci` (log `npm-ci.log`,
  `ELECTRON_SKIP_BINARY_DOWNLOAD=1`). Node 22.14 (repo chce 22.20 z `.tool-versions`).
- Instrukcja dev: `src/docs/development.md`; daemon `npm run dev:server` (127.0.0.1:6768, stan w
  `src/.dev/paseo-home`), build produkcyjny `npm run build:server`, start `npm run start` (domyślnie `~/.paseo`,
  port 6767); web UI daemona: `npm run build:daemon-web-ui`. Pluginy: `src/docs/plugins.md`, `public-docs/plugins/`.

## Uruchomione 2026-11-19
- Web UI zbudowane (`npm run build:daemon-web-ui`, log `build-web-ui.log`).
- Daemon: `paseo-daemon.service` (user, `npm run start`, `PASEO_HOME=~/.paseo`, 127.0.0.1:6767; nie włączony
  przy starcie systemu). Config `~/.paseo/config.json` (hasło bcrypt, hostname sslip.io, webUi). Hasło w
  `~/.paseo/web-password.txt` (0600).
- Caddy: `~/projects/infra-proxy/sites/paseo.caddy` → https://paseo.57-128-254-242.sslip.io
- Pluginy włączone (`pluginsEnabled`). Własny plugin `~/projects/paseo/plugins/moje-sesje` (widok panelu
  bocznego: czeka na Ciebie / pracuje / ostatnie / projekty), zainstalowany, wybrany na telefonie w
  Settings → Sidebar → Sidebar view. Typecheck: symlink `node_modules` → `src/node_modules`, `npx tsc`.

## Remote Control — ZROBIONE 2026-11-19
Kod: fork https://github.com/qubeczek/paseo, gałąź `claude-remote-control` (commit 71ae7b2eb).
Remotes w `src/`: `origin` = fork, `upstream` = getpaseo/paseo. Aktualizacja: `git fetch upstream &&
git rebase upstream/main`, potem `npm ci`, `npm run build:server`, `npm run build:daemon-web-ui`, restart usługi.
Bez PR do upstream (decyzja właściciela).
Commit 85d19681f: zmienne agenta `PASEO_CLAUDE_SESSION_NAME` (→ `claude --name`) i
`PASEO_CLAUDE_REMOTE_CONTROL_NAME` (nazwa w Remote Control), podawane przez `paseo run --env`; potrzebne
dla backendu paseo w bmadx-session (robi go sesja `tuning` w welthix). Usługa: enabled, bez MemoryHigh.
Restart daemona zamyka wszystkie sesje Paseo (closeAllAgents), nie da się tego obejść konfiguracją.

Commit 4a57570a0: nazwa w RC = tytuł agenta w Paseo (bez przedrostka „paseo: ”).
Commit 3e2c4478f: po zerwaniu mostu RC (zmiana konta `/login`) sesja sama rejestruje RC ponownie
(`providers/claude/remote-control.ts`, odczyt `~/.claude/sessions/<pid>.json` co minutę).
Kolejka od `tuning` (backend paseo w bmadx-session wdrożony: welthix d94cbc499 + c254b8dd7):
(1) wznawianie po restarcie daemona, (3) czy `/clear` przez `paseo send` daje nowy sessionId,
(4) `paseo import` bez `--env` gubi nazwę; właściciel chce: po zmianie konta Paseo wznawia pracę sesji.

Commit 2619759ca: `paseo import --env KEY=value` (pole `env` w import_agent_request, launchEnv rekordu).
Sprawdzone: `/clear` przez `paseo send` → ten sam pid, nowy sessionId, Paseo go śledzi, RC zostaje.

## Plugin `wznawianie` (`plugins/wznawianie`, zainstalowany)
Tura sesji Claude padła na błędzie API → wpis w `~/.paseo/plugin-data/wznawianie/state.json`; co minutę
decyzja (`server/decide.ts`): zmiana konta (accountUuid w `~/.claude/.credentials.json`) → wznów od razu;
AUTH tylko po zmianie konta; reset z komunikatu → po resecie; RESUME po 3 min, potem co 15 min, max 5.
Fraza jak w watchdogu welthix. Tura zakończona sukcesem / archiwizacja → wpis znika. Testy: vitest w `server/`.
Watchdog welthix ma pomijać `entrypoint: "sdk-cli"` (przekazane do `tuning`).

## Plugin `plansza` (`plugins/plansza`, zainstalowany 2026-11-20)
Ekran + element nagłówka paska bocznego „Plansza”: sesje ze wszystkich hostów (kolekcje pluginu obejmują
wszystkie podłączone hosty), „Zajrzyj tutaj” (zgoda/błąd, skończone nieprzeczytane, cicha linia wstrzymanych
z `wznawianie/state.json`), projekty (tabela dla deweloperskich/BMAD, kafelki dla pobocznych), kafelek backlogu
BMAD z RPC `board.status` (sprint-status, `pm_queue.py --json`, flow.md z worktree, tytuły z epics, linia
karty PM; cache 60 s). Układ (`layout`, scope host) edytowany w „Ułóż projekty”. Makieta: artefakt
T6nMC3SPFefJ74RhY23hJ3. Kod w forku: `src/fork-plugins/` (stąd instalacja na każdym hoście).
Projekt = nazwa katalogu (ten sam katalog na kilku hostach to jeden projekt). Jedna plansza dla wszystkich
hostów: zmiana w aplikacji forka `callHostRpc` (6d32925fe, `packages/app/src/plugins/{evaluate,hosts/index}.ts`)
— plugin pyta swój odpowiednik na każdym hoście; działa tylko w Web GUI z forka (po `build:daemon-web-ui`,
bez restartu daemona). Telefon 0.16: widok panelu bocznego „Plansza”, backlog tylko z wybranego hosta.

## Plugin `artefakty` (`plugins/artefakty`, zainstalowany 2026-11-20, zgoda właściciela)
Claude Code w trybie SDK wyłącza Artifact (bramka `sdk_default_off`, 2.1.329); hook `agent.open.before`
dokłada `CLAUDE_CODE_ARTIFACT=1` sesjom claude. Zgłoszenie w-tagi. Do sprawdzenia: przeładowanie
bezczynnych sesji pod holdem przy następnej wiadomości; SendUserFile niewidoczny w RC — niezbadane.

## Windows
Instrukcja: `src/SETUP-WINDOWS.md` (na forku) — daemon z forka, autostart, relay, link parowania; poprawki
sesji Windows w 75ed46e69 (Claude Desktop vs CLI w PATH, pełny stop+start). LT01313 (aquila) podłączony
2026-11-20; harness aquili ma dostać backend paseo (instrukcja dla sesji tuning tam).

## Supervisor
`agents.resumeOnStartup: true` + `agents.resumePrompt` = fraza watchdoga (włączone 2026-11-19, decyzja
właściciela): po restarcie daemona wracają sesje, które miały trwającą turę; sprawdzone na żywo.
`paseo-supervisor.service` (oneshot, WantedBy=paseo-daemon) → `supervisor/ensure-supervisor.sh`: po każdym
starcie daemona zakłada sesję z etykietą `role=supervisor` (cwd ~/projects/paseo, opus/medium, bypass,
nazwa `supervisor`, w RC ta sama nazwa) albo budzi zamkniętą jedną wiadomością. `agents.resumeOnStartup`
celowo wyłączone. `mcp.injectIntoAgents` zostaje włączone (decyzja właściciela: Paseo = ogólne zarządzanie
sesjami; wznawianie, watchdogi itp. docelowo w Paseo, bmadx-session tylko warstwa welthix).
- `providers/claude/agent.ts`: `enableRemoteControl()` po każdym `claudeQuery` (wyłączenie:
  `PASEO_CLAUDE_REMOTE_CONTROL=0`), URL → nowe zdarzenie `metadata_changed` (`agent-sdk-types.ts`,
  obsługa w `agent-manager.ts`) → `agent.metadata.remoteControlUrl`; plugin pokazuje przycisk „Claude ↗”.
- Sprawdzone: sesja z `paseo run` dostaje URL, wpis `~/.claude/sessions/<pid>.json` ma `bridgeSessionId`,
  `status`, `entrypoint: sdk-cli` (rejestr działa jak dla sesji z terminala — ważne dla bmadx-session).
- Do zrobienia: backend `paseo` w bmadx-session (welthix `.claude/scripts/harness/session.py`, `inject.py`).

## (archiwalne) Kluczowa poprawka — Remote Control dla sesji Claude
Paseo uruchamia Claude przez Agent SDK (`packages/server/src/server/agent/providers/claude/query.ts`,
`agent.ts`) i NIE włącza Remote Control. Sprawdzone 2026-11-19 na tym hoście: polecenie SDK
`{"type":"control_request","request":{"subtype":"remote_control","enabled":true,"name":"<nazwa>"}}`
(to wysyła `Query.enableRemoteControl(true, name)`) zwraca `session_url: https://claude.ai/code/session_…`,
a rejestr `~/.claude/sessions/<pid>.json` dostaje `bridgeSessionId`. Ustawienie
`--settings '{"remoteControlAtStartup":true}'` w trybie SDK NIE działa.
→ Dopisać wywołanie `enableRemoteControl` po starcie sesji w providerze Claude (najlepiej opcja per agent),
pokazać link `session_url` w UI Paseo (przycisk „Otwórz w Claude”), rozważyć PR do upstream.

## Otoczenie hosta
- VPS 57.128.254.242, bez Tailscale; Caddy w kontenerze `infra-proxy-caddy-1`, strony w
  `~/projects/infra-proxy/sites/*.caddy`, przeładowanie `./reload.sh` (wzór: `sites/t3.caddy`, nazwa sslip.io).
- Pamięć ciasna (~23 GB, równolegle sesje story Welthix w bramkach CI; `/tmp` to tmpfs). Nie budować
  aplikacji mobilnej/desktop na tym hoście.
- Poprzednia próba: T3 Code (`t3code.service`, 127.0.0.1:3773, `t3.57-128-254-242.sslip.io`) — porzucona jako
  baza; usługę można zatrzymać (`systemctl --user disable --now t3code`) po decyzji właściciela.
- Raporty porównawcze narzędzi i mapa wymagań: `research/` (paseo.md, requirements.md…); wnioski o Paseo:
  daemon per host, relay E2E, parowanie per urządzenie, aplikacja iOS w App Store, pluginy (sidebar,
  renderery timeline, backend), CLI `paseo run`, Codex przez `codex app-server`.

## Czeka na restart (za zgodą właściciela), stan 2026-11-21 ~13:30 UTC
- **VPS**: dist zbudowany z 858a13cb3 (pompa strumienia dla sesji ponownie podłączonych pod holdem:
  tury, które Claude zaczyna sam, widać w Paseo od razu). Restart zwykły (`systemctl --user restart
  paseo-daemon`); zmiany unitu z dawnego `deploy-restart.sh` już weszły 2026-11-21 11:05.
- **LT01313**: kod na a14bf74ab (git pull zrobiony, pluginy plansza i moje-sesje przeładowane i
  zainstalowane bez restartu). Restart + `npm ci` + `build:server` + supervisor-rola + zadanie
  Harmonogramu dla `supervisor (01)`: `SETUP-WINDOWS.md`, krok 4a.
- Połączenie daemonów: VPS→LT i LT→VPS działa (LT z hasłem w `relay://…&password=`).
- Plansza: kolejność projektów zapisana per host; na VPS aquila-fk, welthix, sort „Moja kolejność”.

## Skill supervisora
`.claude/skills/paseo-supervisor/SKILL.md` (jedyne źródło roli) + plugin `plugins/supervisor-rola`:
przy każdym otwarciu sesji z etykietą `role=supervisor` dokleja treść skilla do instrukcji systemowych.

## Do rozważenia (zgłoszenie z tuning)
Sesje story startują w głównym klonie, więc każdy agent ma workspace nazwany od gałęzi (`main`);
harness przemianowuje workspace na nazwę sesji. W Paseo: spójny widok mobile/web (tytuł agenta vs
nazwa workspace) i sens nazwy workspace z gałęzi przy wielu agentach w jednym katalogu.
