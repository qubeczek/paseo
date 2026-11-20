# Paseo na Windows — tylko daemon, podłączony do VPS przez relay

Instrukcja dla sesji Claude Code na komputerze z Windows. Cel: na tym komputerze działa **sam daemon
Paseo** (bez web UI), który uruchamia i nadzoruje sesje Claude na tej maszynie i udostępnia je przez
**relay Paseo** (szyfrowanie end-to-end, bez otwierania portów). Interfejs web jest tylko na VPS
(`https://paseo.57-128-254-242.sslip.io`); tam i w telefonie właściciel dodaje ten komputer jako drugi host.

Ten fork (gałąź `claude-remote-control`) zawiera poprawki: każda sesja Claude uruchomiona przez Paseo
włącza Remote Control (widać ją w aplikacji Claude) i sama odnawia most po zmianie konta (`/login`).
Dlatego budujemy ze źródeł, a nie z `npm install -g @getpaseo/cli`.

Konto Claude na tym komputerze może być inne niż na VPS — to nie przeszkadza. Sesje uruchamiane tu przez
Paseo używają konta zalogowanego w Claude Code na tej maszynie (jego limitów); Remote Control tych sesji
widać w aplikacji Claude **tego** konta. Paseo (web UI na VPS, telefon) widzi je niezależnie od konta.
Nie loguj się ponownie ani nie zmieniaj konta w ramach tej instrukcji.

Nie zmieniaj niczego poza tym, co tu opisane. Każdy krok sprawdź, zanim przejdziesz dalej; błąd zgłoś
właścicielowi dosłownie.

## 1. Wymagania

- Node.js **22.20** lub nowszy (`node -v`; sprawdzone na 22.x i 24.16). Starszy → zainstaluj 22 LTS
  (np. `winget install OpenJS.NodeJS.LTS`) i otwórz nowy terminal. Nowszego nie zmieniaj.
- Git (`git --version`).
- Claude Code zainstalowany i zalogowany; `claude --version` musi wypisać `... (Claude Code)` — patrz 1a.
- Wolne ~3 GB na dysku (zależności). Aplikacji desktop/mobile **nie budujemy**.

## 1a. `claude` w PATH musi być Claude Code CLI, nie Claude Desktop

Aplikacja **Claude Desktop** instaluje własny `claude.exe` (`%LOCALAPPDATA%\AnthropicClaude`). Jeśli jest w PATH
przed CLI (`%USERPROFILE%\.local\bin`), `claude --version` wypisuje coś w stylu `5.11492.5` zamiast
`2.x.y (Claude Code)`, a każda sesja uruchomiona przez Paseo kończy się błędem (`Unable to parse Claude Code
version`, `Unable to move the cache: Odmowa dostępu`, `Claude stream ended before terminal result`).

Sprawdź:

```powershell
Get-Command claude -All | ForEach-Object { "$($_.Source)  ->  $(& $_.Source --version)" }
```

Jeśli **pierwsza** linia nie kończy się na `(Claude Code)`, przesuń w PATH użytkownika katalog CLI przed
`AnthropicClaude` (edycja surowej wartości z rejestru — zachowuje `%ZMIENNE%` i typ wartości; kopia zapasowa
trafia do `%USERPROFILE%\path-user-backup.txt`):

```powershell
$k = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment', $true)
$raw = $k.GetValue('Path', $null, 'DoNotExpandEnvironmentNames'); $kind = $k.GetValueKind('Path')
Set-Content "$env:USERPROFILE\path-user-backup.txt" $raw -Encoding utf8
$parts = [System.Collections.Generic.List[string]]($raw -split ';')
$cli = $parts | Where-Object { $_ -match '\\\.local\\bin\\?$' } | Select-Object -First 1
if ($cli) { [void]$parts.Remove($cli) }
$i = $parts.FindIndex([Predicate[string]]{ param($x) $x -match 'AnthropicClaude\\?$' })
if ($cli -and $i -ge 0) { $parts.Insert($i, $cli); $k.SetValue('Path', ($parts -join ';'), $kind) }
$k.Close()
[Environment]::SetEnvironmentVariable("PASEO_TMP", "1", "User"); [Environment]::SetEnvironmentVariable("PASEO_TMP", $null, "User")
```

(Dwie ostatnie linie tylko rozgłaszają zmianę środowiska do systemu.) Otwórz **nowy** terminal i powtórz
sprawdzenie — pierwsza linia ma kończyć się na `(Claude Code)`. Jeśli `.local\bin` jest w PATH systemowym
albo CLI leży gdzie indziej, nie kombinuj — zgłoś właścicielowi wynik sprawdzenia.

Aktualizacja Claude Desktop może PATH znowu przestawić, dlatego w kroku 3a dodatkowo wpisujemy ścieżkę CLI
na sztywno w konfiguracji Paseo.

## 2. Pobranie i build

W PowerShell, w katalogu na projekty (np. `C:\projects`):

```powershell
git clone --branch claude-remote-control https://github.com/qubeczek/paseo.git paseo
cd paseo
git remote add upstream https://github.com/getpaseo/paseo.git
$env:ELECTRON_SKIP_BINARY_DOWNLOAD = "1"
npm ci
npm run build:server
```

`npm run build:daemon-web-ui` **pomijamy** — web UI ma być tylko na VPS.

Sprawdź: `node packages\cli\bin\paseo --version` wypisuje wersję.

## 3. Start daemona

```powershell
node packages\cli\bin\paseo daemon start
node packages\cli\bin\paseo daemon status
```

Daemon słucha tylko na `127.0.0.1:6767`, stan w `%USERPROFILE%\.paseo`. Web UI jest domyślnie wyłączone — nie
włączaj go. Hasła nie ustawiamy: daemon nie jest wystawiony w sieci, a relay ma własne parowanie urządzeń.

## 3a. Ścieżka do Claude Code CLI w konfiguracji Paseo

Zabezpieczenie na wypadek, gdyby PATH znowu wskazał Claude Desktop (patrz 1a). Plik
`%USERPROFILE%\.paseo\config.json` tworzy daemon przy pierwszym starcie (krok 3):

```powershell
$cli = Get-Command claude -All | Where-Object { "$(& $_.Source --version 2>$null)" -match 'Claude Code' } |
  Select-Object -First 1 -ExpandProperty Source
if (-not $cli) { throw "Nie znaleziono Claude Code CLI w PATH - zgłoś właścicielowi" }
$cfgPath = "$env:USERPROFILE\.paseo\config.json"
Copy-Item $cfgPath "$cfgPath.bak"
$cfg = Get-Content $cfgPath -Raw | ConvertFrom-Json
$claude = [pscustomobject]@{ command = [pscustomobject]@{ mode = "replace"; argv = @($cli) } }
if (-not $cfg.agents) { $cfg | Add-Member agents ([pscustomobject]@{}) }
if (-not $cfg.agents.providers) { $cfg.agents | Add-Member providers ([pscustomobject]@{}) }
$cfg.agents.providers | Add-Member claude $claude -Force
[IO.File]::WriteAllText($cfgPath, ($cfg | ConvertTo-Json -Depth 10))
Get-Content $cfgPath
```

W wyniku ma być `agents.providers.claude.command.argv` = ścieżka do `...\.local\bin\claude.exe`.

## 3b. Powiadomienia jak na VPS i restart

Push na telefon tylko wtedy, gdy sesja czeka na zgodę albo stoi na błędzie dłużej niż 2 minuty (zakończone
tury bez pusha). Zmienne użytkownika:

```powershell
[Environment]::SetEnvironmentVariable("PASEO_NOTIFY_REASONS", "permission,error", "User")
[Environment]::SetEnvironmentVariable("PASEO_PUSH_DELAY_MS", "120000", "User")
```

Teraz **pełny** restart daemona — `stop` + `start`, nie `daemon restart`. `daemon restart` podmienia tylko
proces workera, który dziedziczy środowisko starego supervisora, więc nowe zmienne by nie zadziałały. Zmienne
ustawiamy też w bieżącym procesie, żeby nie zależeć od otwierania nowego terminala:

```powershell
$env:PASEO_NOTIFY_REASONS = "permission,error"
$env:PASEO_PUSH_DELAY_MS = "120000"
node packages\cli\bin\paseo daemon stop
node packages\cli\bin\paseo daemon start
node packages\cli\bin\paseo daemon status
```

W `status` provider `claude` ma `"available":true`.

## 4. Autostart po zalogowaniu

Zadanie Harmonogramu zadań uruchamiające daemona przy logowaniu użytkownika (podmień ścieżkę, jeśli klon
jest gdzie indziej):

```powershell
$repo = "C:\projects\paseo"
$node = (Get-Command node).Source
$action = New-ScheduledTaskAction -Execute $node -Argument "packages\cli\bin\paseo daemon start" -WorkingDirectory $repo
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
Register-ScheduledTask -TaskName "Paseo daemon" -Action $action -Trigger $trigger -Description "Paseo daemon (fork qubeczek/paseo)"
```

## 5. Relay i link parowania

```powershell
node packages\cli\bin\paseo daemon pair --relay
```

Polecenie włącza relay i wypisuje kod QR oraz **link parowania** (`https://app.paseo.sh/#offer=...`).
Przekaż właścicielowi **link** — on wklei go w web UI na VPS i w telefonie (**Add host → Paste pairing link**).
Link daje dostęp do sesji na tym komputerze: przekaż go tylko właścicielowi, nie wpisuj do plików w repo.

## 6. Sprawdzenie

Uruchom krótką sesję testową przez Paseo w dowolnym katalogu roboczym:

```powershell
node packages\cli\bin\paseo run --provider claude --model haiku --title "test windows" --cwd $env:USERPROFILE "Odpowiedz jednym słowem: ok"
```

Oczekiwane: status `completed`; w `%USERPROFILE%\.paseo\daemon.log` linia `Claude Remote Control enabled`
z `remoteControlUrl`; sesja „test windows” widoczna w aplikacji Claude (nazwa sesji = tytuł w Paseo). Potem:
`node packages\cli\bin\paseo archive <id>`.

Status `error` z `Unable to parse Claude Code version` / `Unable to move the cache` w logu = Paseo uruchamia
Claude Desktop zamiast CLI → wróć do 1a i 3a, potem pełny restart z 3b.

## 7. Raport dla właściciela

Na koniec podaj właścicielowi krótko: nazwę komputera (`hostname`), wersję daemona, wynik testu z kroku 6
i **link parowania** z kroku 5. Wypisz też, jakie sesje Claude działają teraz na tym komputerze poza
Paseo (katalog `%USERPROFILE%\.claude\sessions\*.json`: pola `name`, `cwd`, `status`) — niczego w nich nie
zmieniaj; to tylko obraz sytuacji do podłączenia ich później.

## Aktualizacja (później)

```powershell
cd C:\projects\paseo
git pull
npm ci
npm run build:server
node packages\cli\bin\paseo daemon stop
node packages\cli\bin\paseo daemon start
```

Jeśli od instalacji aktualizował się Claude Desktop, najpierw powtórz sprawdzenie z 1a. Restart daemona kończy wszystkie sesje uruchomione przez Paseo na tym komputerze — rób go tylko w przerwie.
