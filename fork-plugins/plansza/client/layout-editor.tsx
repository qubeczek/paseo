import { useSettings } from "@getpaseo/plugin/client";
import { useCallback } from "react";
import { Pressable, Text, View } from "react-native";
import { layoutSettings, type Layout, type ProjectKind } from "../shared/contracts";
import type { Styles } from "./board";

function Chip({ label, onPress, styles, on, a11y }: { label: string; onPress: () => void; styles: Styles; on?: boolean; a11y?: string }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11y ?? label}
      accessibilityState={on === undefined ? undefined : { selected: on }}
      onPress={onPress}
      style={[styles.button, on ? { backgroundColor: styles.c.accent, borderColor: styles.c.accent } : null]}
    >
      <Text style={{ color: on ? styles.c.accentForeground : styles.c.foreground, fontSize: 14 }}>{label}</Text>
    </Pressable>
  );
}

const toggle = (list: string[], name: string) => (list.includes(name) ? list.filter((n) => n !== name) : [...list, name]);
const KIND_LABEL: Record<ProjectKind, string> = { dev: "Deweloperski", side: "Poboczny" };

/** Order, kind (dev/side), collapse, hide and backlog per project; saved on the host for every client. */
export function LayoutEditor({ names, withBacklog, styles, onDone }: { names: string[]; withBacklog: Set<string>; styles: Styles; onDone: () => void }) {
  const settings = useSettings(layoutSettings);
  const layout: Layout | null = settings.status === "ready" ? settings.values : null;
  const save = useCallback(
    (next: Layout) => {
      if (settings.status === "ready") void settings.save(next, settings.revision);
    },
    [settings],
  );
  if (!layout) {
    return <Text style={styles.muted}>{settings.status === "loading" ? "Wczytuję układ…" : `Układ niedostępny: ${"error" in settings ? settings.error : ""}`}</Text>;
  }
  // Projects in saved order first, then the ones never ordered, alphabetically.
  const ordered = [...names].sort((a, b) => {
    const ia = layout.order.indexOf(a);
    const ib = layout.order.indexOf(b);
    return (ia === -1 ? 1e9 : ia) - (ib === -1 ? 1e9 : ib) || a.localeCompare(b);
  });
  const move = (name: string, delta: number) => {
    const list = [...ordered];
    const from = list.indexOf(name);
    const to = from + delta;
    if (to < 0 || to >= list.length) return;
    list.splice(from, 1);
    list.splice(to, 0, name);
    save({ ...layout, order: list });
  };
  const setKind = (name: string, kind: ProjectKind | null) => {
    const kinds = { ...layout.kinds };
    if (kind) kinds[name] = kind;
    else delete kinds[name];
    save({ ...layout, kinds });
  };
  return (
    <View style={{ gap: 16 }}>
      <View style={[styles.row, { justifyContent: "space-between" }]}>
        <Text accessibilityRole="header" style={{ color: styles.c.foreground, fontSize: 22, fontWeight: "700" }}>
          Ułóż projekty
        </Text>
        <Chip label="Gotowe" onPress={onDone} styles={styles} on />
      </View>
      <View style={[styles.card, { gap: 8 }]}>
        <Text style={styles.label}>Kolejność</Text>
        <View style={[styles.row, { flexWrap: "wrap", gap: 8 }]}>
          <Chip label="Moja kolejność" on={layout.sort === "mine"} onPress={() => save({ ...layout, sort: "mine" })} styles={styles} />
          <Chip label="Najpierw te, które na mnie czekają" on={layout.sort === "waiting"} onPress={() => save({ ...layout, sort: "waiting" })} styles={styles} />
        </View>
      </View>
      {ordered.map((name) => {
        const hidden = layout.hidden.includes(name);
        const kind = layout.kinds[name] ?? null;
        return (
          <View key={name} style={[styles.card, { gap: 8, opacity: hidden ? 0.6 : 1 }]}>
            <View style={[styles.row, { justifyContent: "space-between" }]}>
              <Text style={[styles.text, { fontWeight: "600" }]}>{name}</Text>
              <Text style={styles.muted}>{[kind ? KIND_LABEL[kind] : "bez grupy", hidden ? "ukryty" : null].filter(Boolean).join(" · ")}</Text>
            </View>
            <View style={[styles.row, { flexWrap: "wrap", gap: 6 }]}>
              <Chip label="↑" a11y={`${name} w górę`} onPress={() => move(name, -1)} styles={styles} />
              <Chip label="↓" a11y={`${name} w dół`} onPress={() => move(name, 1)} styles={styles} />
              <Chip label="Deweloperski" on={kind === "dev"} onPress={() => setKind(name, kind === "dev" ? null : "dev")} styles={styles} />
              <Chip label="Poboczny" on={kind === "side"} onPress={() => setKind(name, kind === "side" ? null : "side")} styles={styles} />
              <Chip
                label={layout.collapsed.includes(name) ? "Zwinięty" : "Rozwinięty"}
                onPress={() => save({ ...layout, collapsed: toggle(layout.collapsed, name) })}
                styles={styles}
              />
              {withBacklog.has(name) ? (
                <Chip
                  label={layout.noBacklog.includes(name) ? "Backlog: nie" : "Backlog: tak"}
                  onPress={() => save({ ...layout, noBacklog: toggle(layout.noBacklog, name) })}
                  styles={styles}
                />
              ) : null}
              <Chip label={hidden ? "Pokaż" : "Ukryj"} onPress={() => save({ ...layout, hidden: toggle(layout.hidden, name) })} styles={styles} />
            </View>
          </View>
        );
      })}
      <Text style={styles.muted}>
        Układ zapisuje się na wybranym hoście, więc w przeglądarce i na telefonie jest ten sam. Ukryty projekt wraca na planszę
        sam, gdy któraś jego sesja zacznie na Ciebie czekać.
      </Text>
      {settings.saveError ? <Text style={{ color: styles.c.statusDanger }}>{settings.saveError}</Text> : null}
    </View>
  );
}
