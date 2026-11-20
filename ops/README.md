# ops — uruchomienie forka na VPS właściciela

Pliki, które wcześniej leżały tylko na VPS (`~/projects/paseo`). Tam zostały dowiązania do tych plików, więc
usługi i plugin `supervisor-rola` działają bez zmian ścieżek.

| Plik | Co to jest |
|---|---|
| `START.md` | Notatka startowa: stan instalacji, decyzje, otwarte sprawy (`~/projects/paseo/START.md`) |
| `systemd/` | Kopie unitów użytkownika `paseo-daemon.service` i `paseo-supervisor.service` (żywe w `~/.config/systemd/user/`) |
| `supervisor/ensure-supervisor.sh` | Po starcie daemona zakłada lub budzi sesję `role=supervisor` |
| `supervisor/deploy-and-notify.sh`, `deploy-restart.sh` | Restart daemona z nowym kodem (tylko za zgodą właściciela) |
| `skills/paseo-supervisor/SKILL.md` | Rola supervisora; plugin `fork-plugins/supervisor-rola` dokleja ją do sesji supervisora |
| `caddy/paseo.caddy` | Kopia witryny z `~/projects/infra-proxy/sites/` (HTTPS przed daemonem) |

Hasła nie ma w repo: skrypty czytają je z `~/.paseo/web-password.txt`. Raporty porównawcze (`research/`) zostają lokalnie.
