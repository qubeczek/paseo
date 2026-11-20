# Pluginy Paseo forka (claude-remote-control)

Pluginy właściciela, instalowane na każdym daemonie z lokalnego katalogu (Paseo uruchamia je z tego miejsca).
Poza workspace'ami npm repo — `npm ci` w korzeniu ich nie dotyka.

| Plugin       | Co robi                                                                                                                      |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `plansza`    | Ekran „Plansza”: sesje ze wszystkich hostów, co czeka na Ciebie, projekty, backlog BMAD (czyta pliki projektu na tym hoście) |
| `artefakty`  | Dokłada `CLAUDE_CODE_ARTIFACT=1` sesjom Claude — bez tego tryb SDK wyłącza narzędzie Artifact                                |
| `wznawianie` | Wznawia sesje po limicie konta / błędzie API                                                                                 |
| `moje-sesje` | Widok panelu bocznego: sesje według pilności                                                                                 |

## Instalacja (Linux / Windows PowerShell)

Z korzenia repo, po `git pull`. Polecenia działają w bash i w PowerShell.

1. Zależności. `artefakty` korzysta z zestawu zależności `plansza`; na Linuksie wystarczy dowiązanie
   `node_modules`, na Windows uruchom w nim osobny `npm install`:

   ```
   cd fork-plugins/plansza
   npm install --no-audit --no-fund
   cd ../artefakty
   npm install --no-audit --no-fund
   cd ../..
   ```

2. Włącz pluginy w daemonie. Na świeżym daemonie główny przełącznik `pluginsEnabled` jest wyłączony: `plugin
install` przechodzi, ale `plugin ls` pokazuje `STATUS disabled` przy `ENABLED yes`. CLI nie ma na to polecenia,
   więc użyj skryptu (zmiana działa od razu, bez restartu daemona, i zostaje zapisana w `config.json`):

   ```
   node fork-plugins/enable-plugins.mjs
   ```

   Zamiast tego możesz też wpisać `"pluginsEnabled": true` w `~/.paseo/config.json`, ale daemon nie śledzi zmian w tym
   pliku, więc wtedy potrzebny jest restart daemona.

3. Instalacja pluginów. Podaj pełną ścieżkę, np. `C:\projects\paseo\fork-plugins\plansza`:

   ```
   node packages/cli/bin/paseo plugin install <pełna ścieżka>/fork-plugins/plansza --id plansza
   node packages/cli/bin/paseo plugin install <pełna ścieżka>/fork-plugins/artefakty --id artefakty
   node packages/cli/bin/paseo plugin install <pełna ścieżka>/fork-plugins/wznawianie --id wznawianie
   node packages/cli/bin/paseo plugin install <pełna ścieżka>/fork-plugins/moje-sesje --id moje-sesje
   ```

4. Sprawdzenie: `node packages/cli/bin/paseo plugin ls` ma pokazać każdy plugin z `STATUS running`, `ENABLED yes`
   i pustą kolumną `ERROR`. Jeśli jest `disabled` — wróć do kroku 2.

Aktualizacja: `git pull`, potem `node packages/cli/bin/paseo plugin reload <id>` (restart daemona niepotrzebny).
Pluginy na Linuksie i Windows są te same; ścieżki projektów czytane z konfiguracji harnessu.
