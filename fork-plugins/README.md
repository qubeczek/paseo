# Pluginy Paseo forka (claude-remote-control)

Pluginy właściciela, instalowane na każdym daemonie z lokalnego katalogu (Paseo uruchamia je z tego miejsca).
Poza workspace'ami npm repo — `npm ci` w korzeniu ich nie dotyka.

| Plugin | Co robi |
|---|---|
| `plansza` | Ekran „Plansza”: sesje ze wszystkich hostów, co czeka na Ciebie, projekty, backlog BMAD (czyta pliki projektu na tym hoście) |
| `artefakty` | Dokłada `CLAUDE_CODE_ARTIFACT=1` sesjom Claude — bez tego tryb SDK wyłącza narzędzie Artifact |
| `wznawianie` | Wznawia sesje po limicie konta / błędzie API |
| `moje-sesje` | Widok panelu bocznego: sesje według pilności |

## Instalacja (Linux / Windows PowerShell)

Z katalogu repo, po `git pull`:

```
cd fork-plugins/plansza && npm install --no-audit --no-fund && cd ../..
node packages/cli/bin/paseo plugin install <pełna ścieżka>/fork-plugins/plansza --id plansza
node packages/cli/bin/paseo plugin install <pełna ścieżka>/fork-plugins/artefakty --id artefakty
node packages/cli/bin/paseo plugin install <pełna ścieżka>/fork-plugins/wznawianie --id wznawianie
node packages/cli/bin/paseo plugin install <pełna ścieżka>/fork-plugins/moje-sesje --id moje-sesje
node packages/cli/bin/paseo plugin ls
```

`artefakty` korzysta z zależności `plansza` (ten sam zestaw) — na Windows zamiast dowiązania uruchom w nim też
`npm install`. Aktualizacja: `git pull`, potem `node packages/cli/bin/paseo plugin reload <id>` (restart daemona
niepotrzebny). Pluginy na Linuksie i Windows są te same; ścieżki projektów czytane z konfiguracji harnessu.
