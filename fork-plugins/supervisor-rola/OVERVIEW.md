Rola supervisor: przy każdym otwarciu sesji z etykietą `role=supervisor` (start, wznowienie, restart,
import) dokleja do jej instrukcji systemowych skill `paseo-supervisor`
(`~/projects/paseo/.claude/skills/paseo-supervisor/SKILL.md`, czytany przy każdym otwarciu). Sesja
supervisor zarządza tylko daemonem i sesjami, a inne tematy kieruje do właściwych sesji.
