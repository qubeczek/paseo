Artefakty: Claude Code uruchomiony przez Paseo (tryb SDK, stream-json) domyślnie wyłącza narzędzie Artifact
(bramka `sdk_default_off`). Plugin przy każdym otwarciu sesji Claude dokłada `CLAUDE_CODE_ARTIFACT=1`, więc
sesje Paseo — także te z bmadx-session i PM — mogą publikować artefakty jak sesje terminalowe.
