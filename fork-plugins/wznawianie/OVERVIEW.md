Wznawianie sesji: gdy tura sesji Claude padnie na błędzie API (limit użycia, przeciążenie, wylogowanie),
plugin zapamiętuje sesję i wysyła jej „wróć do przerwanej pracy, bez pytań i nowych decyzji” — po zmianie
konta Claude (`/login`), po godzinie resetu limitu z komunikatu albo po krótkim postoju (z limitem prób).
Stan: `$PASEO_HOME/plugin-data/wznawianie/state.json`, log: `paseo plugin logs wznawianie`.
