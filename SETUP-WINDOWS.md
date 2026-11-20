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

- Node.js **22.20** lub nowszy z linii 22 (`node -v`). Starszy → zainstaluj 22 LTS (np. `winget install OpenJS.NodeJS.LTS`)
  i otwórz nowy terminal.
- Git (`git --version`).
- Claude Code zainstalowany i zalogowany (`claude --version`).
- Wolne ~3 GB na dysku (zależności). Aplikacji desktop/mobile **nie budujemy**.

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

## 3a. Powiadomienia jak na VPS

Push na telefon tylko wtedy, gdy sesja czeka na zgodę albo stoi na błędzie dłużej niż 2 minuty (zakończone
tury bez pusha). Zmienne użytkownika, potem restart daemona w nowym terminalu:

```powershell
[Environment]::SetEnvironmentVariable("PASEO_NOTIFY_REASONS", "permission,error", "User")
[Environment]::SetEnvironmentVariable("PASEO_PUSH_DELAY_MS", "120000", "User")
```

Otwórz nowy terminal (zmienne działają w nowych procesach) i:
`node packages\cli\bin\paseo daemon restart`.

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
node packages\cli\bin\paseo daemon restart
```

Restart daemona kończy wszystkie sesje uruchomione przez Paseo na tym komputerze — rób go tylko w przerwie.
