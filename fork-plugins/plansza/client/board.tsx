import { useQuery } from "@tanstack/react-query";
import type { PluginAgentSnapshot } from "@getpaseo/plugin";
import {
  useAgent,
  useAgents,
  useHosts,
  useRpc,
  useSettings,
  useWorkspace,
  useWorkspaces,
  type AgentRef,
  type PluginScreenProps,
  type WorkspaceRef,
} from "@getpaseo/plugin/client";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Linking, Pressable, ScrollView, Text, View } from "react-native";
import { boardStatus, layoutSettings, type Backlog, type Layout } from "../shared/contracts";
import { LayoutEditor } from "./layout-editor";
import { sessionState, since, stateColor, storyOf, type SessionState, type StateKind } from "./status";

type Props = PluginScreenProps;

const EMPTY_LAYOUT: Layout = { sort: "waiting", order: [], kinds: {}, hidden: [], collapsed: [], noBacklog: [] };
// Archived agents never reach the plugin snapshot; a closed one is a resumable session without a process.
const visible = (agent: PluginAgentSnapshot) => !agent.background && agent.parentAgentId === null;

/** Re-render every 30 s so "6 min" labels stay true. */
function useNow(): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/** `#rrggbb` + alpha → `#rrggbbaa`; other color formats stay as they are. */
function tint(color: string, alpha: number): string {
  if (/^#[0-9a-f]{6}$/i.test(color)) {
    return `${color}${Math.round(alpha * 255).toString(16).padStart(2, "0")}`;
  }
  return color;
}

// ---------------------------------------------------------------- data

interface BoardData {
  paused: Map<string, number | null>;
  backlogs: Map<string, Backlog>;
  hostId: string;
}

function useBoardData(props: Props, roots: string[]): BoardData {
  const status = useRpc(boardStatus);
  const query = useQuery({
    queryKey: ["board.status", roots.join("\n")],
    queryFn: () => status({ roots }),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  return useMemo(() => {
    const paused = new Map<string, number | null>();
    for (const entry of query.data?.paused ?? []) paused.set(entry.agentId, entry.resetAt);
    const backlogs = new Map<string, Backlog>();
    for (const backlog of query.data?.backlogs ?? []) backlogs.set(backlog.root, backlog);
    return { paused, backlogs, hostId: props.host.id };
  }, [query.data, props.host.id]);
}

/** Paused entries belong to the plugin's host; agents elsewhere are never paused by it. */
function pausedFor(agent: PluginAgentSnapshot, data: BoardData): number | null | undefined {
  if (agent.hostId !== data.hostId || !data.paused.has(agent.id)) return undefined;
  return data.paused.get(agent.id) ?? null;
}

const stateOf = (agent: PluginAgentSnapshot, data: BoardData) => sessionState(agent, pausedFor(agent, data));

// ---------------------------------------------------------------- styles

function useStyles(props: Props) {
  const { theme, layout } = props;
  return useMemo(() => {
    const c = theme.colors;
    return {
      c,
      compact: layout.compact,
      screen: { flex: 1, backgroundColor: c.surface0 },
      content: { padding: layout.compact ? 16 : 28, gap: 24, paddingBottom: 48 },
      h1: { color: c.foreground, fontSize: layout.compact ? 22 : 26, fontWeight: "700" as const },
      h2: { color: c.foreground, fontSize: 17, fontWeight: "600" as const },
      label: {
        color: c.foregroundMuted,
        fontSize: 11,
        fontWeight: "600" as const,
        letterSpacing: 0.6,
        textTransform: "uppercase" as const,
      },
      text: { color: c.foreground, fontSize: 14 },
      strong: { color: c.foreground, fontSize: 14, fontWeight: "600" as const },
      muted: { color: c.foregroundMuted, fontSize: 13 },
      card: {
        backgroundColor: c.surface1,
        borderColor: c.border,
        borderWidth: 1,
        borderRadius: 14,
        padding: 16,
        gap: 12,
      },
      row: { flexDirection: "row" as const, alignItems: "center" as const, gap: 10 },
      button: {
        borderRadius: 8,
        borderWidth: 1,
        borderColor: c.border,
        paddingHorizontal: 14,
        minHeight: 40,
        justifyContent: "center" as const,
      },
    };
  }, [theme, layout.compact]);
}
export type Styles = ReturnType<typeof useStyles>;

export function Button({
  label,
  onPress,
  styles,
  color,
}: {
  label: string;
  onPress: () => void;
  styles: Styles;
  /** Filled with this color; outlined when absent. */
  color?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={[styles.button, color ? { backgroundColor: color, borderColor: color } : null]}
    >
      <Text style={{ color: color ? styles.c.surface0 : styles.c.foreground, fontSize: 14, fontWeight: color ? "600" : "400" }}>
        {label}
      </Text>
    </Pressable>
  );
}

function Dot({ color, size = 8 }: { color: string; size?: number }) {
  return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />;
}

function remoteControlUrl(agent: PluginAgentSnapshot): string | null {
  const url = agent.metadata.remoteControlUrl;
  return typeof url === "string" && url.startsWith("https://") ? url : null;
}

function openAgent(props: Props, agent: PluginAgentSnapshot) {
  props.navigation?.openAgent({ agentId: agent.id, serverId: agent.hostId });
}

// ---------------------------------------------------------------- header

function Header({ props, styles, data, onEdit }: { props: Props; styles: Styles; data: BoardData; onEdit: () => void }) {
  const hosts = useHosts();
  const now = useNow();
  const c = styles.c;
  const counter = (test: (state: SessionState) => boolean) => (agent: PluginAgentSnapshot) => visible(agent) && test(stateOf(agent, data));
  const waiting = useAgents({ where: counter((s) => s.needsYou) }).length;
  const unread = useAgents({ where: counter((s) => s.kind === "finished") }).length;
  const working = useAgents({ where: counter((s) => s.kind === "working" || s.kind === "background") }).length;
  const idle = useAgents({ where: counter((s) => s.kind === "idle" || s.kind === "paused") }).length;
  const perHost = useAgents({ where: visible, groupBy: (agent) => agent.hostId });
  const sessionsOn = (hostId: string) => perHost.find((group) => group.key === hostId)?.items.length ?? 0;

  const pill = (text: string, color: string | null) => (
    <View
      style={{
        borderRadius: 10,
        paddingHorizontal: 14,
        minHeight: 40,
        justifyContent: "center",
        backgroundColor: color ? tint(color, 0.18) : c.surface1,
        borderWidth: 1,
        borderColor: color ? tint(color, 0.45) : c.border,
      }}
    >
      <Text style={{ color: c.foreground, fontSize: 14, fontWeight: color ? "600" : "400" }}>{text}</Text>
    </View>
  );

  return (
    <View style={{ gap: 14 }}>
      <View style={[styles.row, { flexWrap: "wrap", justifyContent: "space-between", rowGap: 8 }]}>
        <View style={[styles.row, { flexWrap: "wrap", gap: 16 }]}>
          <Text accessibilityRole="header" style={styles.h1}>
            Plansza
          </Text>
          {hosts.map((host) => (
            <View key={host.serverId} style={[styles.row, { gap: 6 }]}>
              <Dot color={host.status === "online" ? c.statusSuccess : c.foregroundMuted} />
              <Text style={styles.muted}>
                {host.label} · {host.status === "online" ? `${sessionsOn(host.serverId)} sesji` : host.status === "connecting" ? "łączy" : "niepołączony"}
              </Text>
            </View>
          ))}
        </View>
        <View style={[styles.row, { gap: 12 }]}>
          <Text style={styles.muted}>na żywo · {new Date(now).toTimeString().slice(0, 5)}</Text>
          <Button label="Ułóż projekty" onPress={onEdit} styles={styles} />
        </View>
      </View>
      <View style={[styles.row, { flexWrap: "wrap", gap: 8 }]}>
        {pill(`${waiting} czeka na Ciebie`, waiting ? c.statusWarning : null)}
        {pill(`${unread} skończyło, nieprzeczytane`, unread ? c.statusSuccess : null)}
        {pill(`${working} pracuje`, working ? c.accent : null)}
        {pill(`${idle} bezczynnych`, null)}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------- needs you

function ProjectName({ reference }: { reference: WorkspaceRef }) {
  const name = useWorkspace(reference, (w) => w.projectDisplayName);
  return <>{name ?? ""}</>;
}

function NeedsYouCard({ reference, props, styles, data }: { reference: AgentRef; props: Props; styles: Styles; data: BoardData }) {
  const agent = useAgent(reference);
  const hosts = useHosts();
  useNow();
  if (!agent) return null;
  const state = stateOf(agent, data);
  const color = stateColor(state.kind, props.theme);
  const host = hosts.length > 1 ? hosts.find((h) => h.serverId === agent.hostId)?.label : null;
  const url = remoteControlUrl(agent);
  return (
    <View style={[styles.card, { backgroundColor: tint(color, 0.1), borderColor: tint(color, 0.5), flexGrow: 1, flexBasis: 300, minWidth: 260 }]}>
      <View style={[styles.row, { justifyContent: "space-between" }]}>
        <Text style={[styles.label, { color }]}>{state.kind === "permission" ? "Prośba o zgodę" : "Błąd"}</Text>
        <Text style={{ color, fontSize: 12, fontWeight: "600" }}>czeka {since(agent.updatedAt)}</Text>
      </View>
      <Text style={styles.text}>
        <Text style={styles.strong}>{agent.title ?? "Bez tytułu"}</Text>
        <Text style={styles.muted}>
          {"  "}
          <ProjectName reference={agent.workspace} />
          {host ? ` · ${host}` : ""}
        </Text>
      </Text>
      <View style={[styles.row, { flexWrap: "wrap", gap: 8 }]}>
        {props.navigation ? <Button label="Otwórz sesję" onPress={() => openAgent(props, agent)} styles={styles} color={color} /> : null}
        {url ? <Button label="Claude ↗" onPress={() => void Linking.openURL(url)} styles={styles} /> : null}
      </View>
    </View>
  );
}

function UnreadLine({ reference, props, styles }: { reference: AgentRef; props: Props; styles: Styles }) {
  const agent = useAgent(reference);
  if (!agent) return null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Otwórz ${agent.title ?? "sesję"}`}
      onPress={() => openAgent(props, agent)}
      style={[styles.row, { minHeight: 36, justifyContent: "space-between" }]}
    >
      <Text numberOfLines={1} style={[styles.text, { flexShrink: 1 }]}>
        <Text style={styles.strong}>{agent.title ?? "Bez tytułu"}</Text>
        <Text style={styles.muted}>
          {"  "}
          <ProjectName reference={agent.workspace} />
        </Text>
      </Text>
      <Text style={styles.muted}>{since(agent.updatedAt)}</Text>
    </Pressable>
  );
}

function NeedsYou({ props, styles, data }: { props: Props; styles: Styles; data: BoardData }) {
  const c = styles.c;
  const byWait = (a: PluginAgentSnapshot, b: PluginAgentSnapshot) =>
    stateOf(a, data).priority - stateOf(b, data).priority || Date.parse(a.updatedAt) - Date.parse(b.updatedAt);
  const waiting = useAgents({ where: (a) => visible(a) && stateOf(a, data).needsYou, orderBy: byWait });
  const unread = useAgents({ where: (a) => visible(a) && stateOf(a, data).kind === "finished", orderBy: ["updatedAt", "desc"] });
  const paused = useAgents({ where: (a) => visible(a) && pausedFor(a, data) !== undefined });
  return (
    <View style={{ gap: 12 }}>
      <View style={[styles.row, { gap: 12 }]}>
        <Text accessibilityRole="header" style={styles.h2}>
          Zajrzyj tutaj
        </Text>
        <Text style={styles.muted}>najdłużej czekające pierwsze</Text>
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
        {waiting.map((reference) => (
          <NeedsYouCard key={reference.key} reference={reference} props={props} styles={styles} data={data} />
        ))}
        <View
          style={[
            styles.card,
            unread.length ? { backgroundColor: tint(c.statusSuccess, 0.08), borderColor: tint(c.statusSuccess, 0.4) } : null,
            { flexGrow: 1, flexBasis: 300, minWidth: 260 },
          ]}
        >
          <View style={[styles.row, { justifyContent: "space-between" }]}>
            <Text style={[styles.label, unread.length ? { color: c.statusSuccess } : null]}>Skończone, nieprzeczytane</Text>
            <Text style={styles.muted}>{unread.length}</Text>
          </View>
          {waiting.length === 0 && unread.length === 0 ? <Text style={styles.muted}>Nic na Ciebie nie czeka.</Text> : null}
          {unread.slice(0, 6).map((reference) => (
            <UnreadLine key={reference.key} reference={reference} props={props} styles={styles} />
          ))}
          {paused.length > 0 ? (
            <Text style={styles.muted}>
              Bez alarmu: {paused.length} {paused.length === 1 ? "sesja wstrzymana" : "sesje wstrzymane"} limitem konta, wrócą same.
            </Text>
          ) : null}
        </View>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------- projects

interface ProjectGroup {
  name: string;
  workspaceKeys: Set<string>;
}

function useProjectGroups(): ProjectGroup[] {
  const groups = useWorkspaces({
    where: (w) => !w.background && w.archivingAt === null,
    groupBy: (w) => w.projectDisplayName,
  });
  return useMemo(
    () => groups.map((group) => ({ name: group.key, workspaceKeys: new Set(group.items.map((item) => item.key)) })),
    [groups],
  );
}

/** Reports the project root of a workspace on the plugin's host (for the backlog RPC). */
function ProjectRoot({ reference, onRoot }: { reference: WorkspaceRef; onRoot: (name: string, root: string) => void }) {
  const info = useWorkspace(reference, (w) => ({ name: w.projectDisplayName, root: w.projectRootPath }));
  useEffect(() => {
    if (info) onRoot(info.name, info.root);
  }, [info?.name, info?.root, onRoot]);
  return null;
}

type Counts = Partial<Record<StateKind, number>> & { total: number; needsYou: number };

/** Reports per-project counts up, so the board can sort, hide empty projects and bring hidden ones back. */
function ProjectCounter({ group, data, onCounts }: { group: ProjectGroup; data: BoardData; onCounts: (name: string, counts: Counts) => void }) {
  const kinds = useAgents({
    where: (a) => visible(a) && group.workspaceKeys.has(a.workspace.key),
    groupBy: (a) => stateOf(a, data).kind,
  });
  const needs = useAgents({ where: (a) => visible(a) && group.workspaceKeys.has(a.workspace.key) && stateOf(a, data).needsYou }).length;
  const signature = kinds.map((g) => `${g.key}:${g.items.length}`).join(",") + `|${needs}`;
  useEffect(() => {
    const counts: Counts = { total: 0, needsYou: needs };
    for (const g of kinds) {
      counts[g.key as StateKind] = g.items.length;
      counts.total += g.items.length;
    }
    onCounts(group.name, counts);
  }, [group.name, signature, onCounts]);
  return null;
}

const SUMMARY: [StateKind, string][] = [
  ["permission", "zgoda"],
  ["error", "błąd"],
  ["finished", "nieprzeczytane"],
  ["working", "pracuje"],
  ["background", "w tle"],
  ["paused", "wstrzymana"],
  ["idle", "bezczynne"],
];

function summary(counts: Counts | undefined): string {
  if (!counts || counts.total === 0) return "bez sesji";
  return SUMMARY.filter(([kind]) => counts[kind])
    .map(([kind, label]) => `${counts[kind]} ${label}`)
    .join(" · ");
}

function useOrderedAgents(group: ProjectGroup, data: BoardData) {
  const order = (a: PluginAgentSnapshot, b: PluginAgentSnapshot) =>
    stateOf(a, data).priority - stateOf(b, data).priority || Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
  return useAgents({ where: (a) => visible(a) && group.workspaceKeys.has(a.workspace.key), orderBy: order });
}

/** "0-206 Zapis kolekcji częściowy · 3F Przegląd końcowy" for a story session; PM line for the PM. */
function useWorkLabel(backlog: Backlog | null) {
  return useCallback(
    (agent: PluginAgentSnapshot): string => {
      const short = storyOf(agent.title);
      const story = short ? backlog?.inProgress.find((s) => s.short === short) : undefined;
      if (story) {
        const title = story.title ? ` ${story.title.split(/\s[—–-]\s|,/)[0]}` : "";
        return `${story.short}${title}${story.phase ? ` · ${story.phase.id} ${story.phase.name}` : ""}`;
      }
      if (backlog?.pm && /(^|-)pm($|[-\s(])/i.test(agent.title ?? "")) return `PM · ${backlog.pm.split(" · ").slice(1).join(" · ")}`;
      if (short) return `story ${short}`;
      return "—";
    },
    [backlog],
  );
}

function TableRow({ reference, props, styles, data, work }: { reference: AgentRef; props: Props; styles: Styles; data: BoardData; work: (a: PluginAgentSnapshot) => string }) {
  const agent = useAgent(reference);
  if (!agent) return null;
  const state = stateOf(agent, data);
  const color = stateColor(state.kind, props.theme);
  const c = styles.c;
  if (styles.compact) {
    return (
      <Pressable accessibilityRole="button" onPress={() => openAgent(props, agent)} style={{ paddingVertical: 8, gap: 2, borderTopWidth: 1, borderTopColor: c.border }}>
        <View style={[styles.row, { justifyContent: "space-between" }]}>
          <View style={[styles.row, { gap: 8, flexShrink: 1 }]}>
            <Dot color={color} />
            <Text numberOfLines={1} style={styles.strong}>
              {agent.title ?? "Bez tytułu"}
            </Text>
          </View>
          <Text style={styles.muted}>
            {state.label} · {since(agent.updatedAt)}
          </Text>
        </View>
        <Text numberOfLines={1} style={[styles.muted, { paddingLeft: 16 }]}>
          {work(agent)}
        </Text>
      </Pressable>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Otwórz ${agent.title ?? "sesję"}`}
      onPress={() => openAgent(props, agent)}
      style={[styles.row, { minHeight: 44, borderTopWidth: 1, borderTopColor: c.border, gap: 12 }]}
    >
      <Text numberOfLines={1} style={[styles.strong, { width: 130 }]}>
        {agent.title ?? "Bez tytułu"}
      </Text>
      <View style={[styles.row, { width: 190, gap: 8 }]}>
        <Dot color={color} />
        <Text numberOfLines={1} style={{ color: state.kind === "idle" ? c.foregroundMuted : c.foreground, fontSize: 14 }}>
          {state.label}
        </Text>
      </View>
      <Text numberOfLines={1} style={[styles.text, { flex: 1 }]}>
        {work(agent)}
      </Text>
      <Text style={[styles.muted, { width: 80, textAlign: "right" }]}>{since(agent.updatedAt)}</Text>
    </Pressable>
  );
}

function ProjectTable({ group, props, styles, data, counts, backlog, root, collapsed }: { group: ProjectGroup; props: Props; styles: Styles; data: BoardData; counts?: Counts; backlog: Backlog | null; root?: string; collapsed: boolean }) {
  const [open, setOpen] = useState(!collapsed);
  useEffect(() => setOpen(!collapsed), [collapsed]);
  const agents = useOrderedAgents(group, data);
  const work = useWorkLabel(backlog);
  return (
    <View style={[styles.card, { gap: 4 }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${open ? "Zwiń" : "Rozwiń"} ${group.name}`}
        onPress={() => setOpen((v) => !v)}
        style={[styles.row, { justifyContent: "space-between", flexWrap: "wrap", minHeight: 36, paddingBottom: 6 }]}
      >
        <View style={[styles.row, { gap: 10 }]}>
          <Text style={[styles.strong, { fontSize: 16 }]}>{group.name}</Text>
          {root ? <Text style={styles.muted}>{root.replace(/^\/home\/[^/]+/, "~")}{backlog ? " · BMAD" : ""}</Text> : null}
        </View>
        <Text style={styles.muted}>
          {summary(counts)} {open ? "▾" : "▸"}
        </Text>
      </Pressable>
      {open && !styles.compact ? (
        <View style={[styles.row, { gap: 12, paddingBottom: 4 }]}>
          <Text style={[styles.label, { width: 130 }]}>Sesja</Text>
          <Text style={[styles.label, { width: 190 }]}>Stan</Text>
          <Text style={[styles.label, { flex: 1 }]}>Nad czym pracuje</Text>
          <Text style={[styles.label, { width: 80, textAlign: "right" }]}>Od</Text>
        </View>
      ) : null}
      {open ? agents.map((reference) => <TableRow key={reference.key} reference={reference} props={props} styles={styles} data={data} work={work} />) : null}
    </View>
  );
}

function TileLine({ reference, props, styles, data }: { reference: AgentRef; props: Props; styles: Styles; data: BoardData }) {
  const agent = useAgent(reference);
  if (!agent) return null;
  const state = stateOf(agent, data);
  return (
    <Pressable accessibilityRole="button" onPress={() => openAgent(props, agent)} style={[styles.row, { minHeight: 32, justifyContent: "space-between" }]}>
      <View style={[styles.row, { gap: 8, flexShrink: 1 }]}>
        <Dot color={stateColor(state.kind, props.theme)} />
        <Text numberOfLines={1} style={styles.text}>
          {agent.title ?? "Bez tytułu"}
        </Text>
      </View>
      <Text style={styles.muted}>{state.kind === "idle" ? since(agent.updatedAt) : `${state.label} · ${since(agent.updatedAt)}`}</Text>
    </Pressable>
  );
}

function ProjectTile({ group, props, styles, data, counts }: { group: ProjectGroup; props: Props; styles: Styles; data: BoardData; counts?: Counts }) {
  const agents = useOrderedAgents(group, data);
  return (
    <View style={[styles.card, { flexGrow: 1, flexBasis: 240, minWidth: 220, gap: 6 }]}>
      <View style={[styles.row, { justifyContent: "space-between" }]}>
        <Text style={styles.strong}>{group.name}</Text>
        <Text style={styles.muted}>{summary(counts)}</Text>
      </View>
      {agents.slice(0, 4).map((reference) => (
        <TileLine key={reference.key} reference={reference} props={props} styles={styles} data={data} />
      ))}
      {agents.length > 4 ? <Text style={styles.muted}>i {agents.length - 4} więcej</Text> : null}
    </View>
  );
}

// ---------------------------------------------------------------- backlog

function BacklogTile({ name, backlog, styles, props }: { name: string; backlog: Backlog; styles: Styles; props: Props }) {
  const [all, setAll] = useState(false);
  const c = styles.c;
  const counts = backlog.counts;
  const queue = backlog.queue ?? [];
  const shown = all ? queue : queue.slice(0, 6);
  const stat = (value: number, label: string, color?: string) => (
    <View style={{ flex: 1, minWidth: 70, backgroundColor: c.surface2, borderRadius: 10, padding: 10, gap: 2 }}>
      <Text style={{ color: color ?? c.foreground, fontSize: 22, fontWeight: "700" }}>{value}</Text>
      <Text style={styles.muted}>{label}</Text>
    </View>
  );
  return (
    <View style={{ gap: 12 }}>
      <Text accessibilityRole="header" style={styles.h2}>
        Backlog · {name}
      </Text>
      <View style={styles.card}>
        <View style={[styles.row, { gap: 8 }]}>
          {stat(backlog.inProgress.length, "w toku", c.accent)}
          {stat(counts["backlog"] ?? 0, "backlog")}
          {stat(counts["blocked"] ?? 0, "blocked", (counts["blocked"] ?? 0) ? c.statusWarning : undefined)}
          {stat(counts["done"] ?? 0, "done", c.statusSuccess)}
        </View>
        {backlog.pm ? <Text style={styles.muted}>PM · {backlog.pm}</Text> : null}
        {backlog.error ? <Text style={{ color: c.statusDanger, fontSize: 13 }}>{backlog.error}</Text> : null}

        {backlog.inProgress.length > 0 ? <Text style={[styles.label, { marginTop: 4 }]}>W toku</Text> : null}
        {backlog.inProgress.map((story) => {
          const fraction = story.total ? story.done / story.total : 0;
          return (
            <View key={story.key} style={{ gap: 5 }}>
              <View style={[styles.row, { justifyContent: "space-between", alignItems: "flex-start" }]}>
                <Text numberOfLines={1} style={[styles.text, { flex: 1 }]}>
                  <Text style={styles.strong}>{story.short}</Text>
                  {story.title ? <Text style={styles.muted}>  {story.title}</Text> : null}
                </Text>
                <Text style={styles.muted}>{story.phase ? `${story.phase.id} ${story.phase.name}` : story.total ? "—" : "stary harness"}</Text>
              </View>
              <View style={{ height: 6, borderRadius: 3, backgroundColor: c.surface2 }}>
                <View style={{ height: 6, borderRadius: 3, width: `${Math.max(4, Math.round(fraction * 100))}%`, backgroundColor: c.accent }} />
              </View>
            </View>
          );
        })}

        {backlog.queue ? (
          <View style={{ gap: 2 }}>
            <Text style={[styles.label, { marginTop: 8, marginBottom: 4 }]}>Kolejka</Text>
            <View style={[styles.row, { gap: 10, paddingBottom: 4 }]}>
              <Text style={[styles.label, { width: 18 }]}>#</Text>
              <Text style={[styles.label, { flex: 1 }]}>Story</Text>
              <Text style={[styles.label, { width: 130, textAlign: "right" }]}>Zależności</Text>
            </View>
            {shown.map((item, index) => (
              <View key={item.short} style={[styles.row, { gap: 10, minHeight: 36, borderTopWidth: 1, borderTopColor: c.border }]}>
                <Text style={[styles.muted, { width: 18 }]}>{index + 1}</Text>
                <Text numberOfLines={1} style={[styles.text, { flex: 1 }]}>
                  <Text style={styles.strong}>{item.short}</Text>
                  {item.title ? <Text style={styles.muted}>  {item.title}</Text> : null}
                </Text>
                <Text numberOfLines={1} style={{ width: 130, textAlign: "right", fontSize: 13, color: item.admissible ? c.statusSuccess : c.statusWarning }}>
                  {item.admissible ? "gotowa do startu" : item.reasons.map((r) => r.replace(/^PO /, "po ")).join(", ") || "czeka"}
                </Text>
              </View>
            ))}
            {queue.length > 6 ? (
              <Pressable accessibilityRole="button" onPress={() => setAll((v) => !v)} style={{ minHeight: 40, justifyContent: "center" }}>
                <Text style={{ color: c.accent, fontSize: 14 }}>{all ? "Zwiń kolejkę" : `Pokaż całą kolejkę (${queue.length})`}</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
        <Text style={[styles.muted, { fontSize: 11 }]}>
          odczyt {new Date(backlog.readAt).toTimeString().slice(0, 5)} · {props.host.label}
        </Text>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------- board

function Section({ title, styles, children }: { title: string; styles: Styles; children: ReactNode }) {
  return (
    <View style={{ gap: 12 }}>
      <Text accessibilityRole="header" style={styles.h2}>
        {title}
      </Text>
      {children}
    </View>
  );
}

export function Board(props: Props) {
  const styles = useStyles(props);
  const settings = useSettings(layoutSettings);
  const layout = settings.status === "ready" ? settings.values : EMPTY_LAYOUT;
  const groups = useProjectGroups();
  const [editing, setEditing] = useState(false);
  const localWorkspaces = useWorkspaces({ where: (w) => !w.background && w.hostId === props.host.id });

  const [roots, setRoots] = useState<Record<string, string>>({});
  const onRoot = useCallback((name: string, root: string) => {
    setRoots((current) => (current[name] === root ? current : { ...current, [name]: root }));
  }, []);
  const [counts, setCounts] = useState<Record<string, Counts>>({});
  const onCounts = useCallback((name: string, next: Counts) => {
    setCounts((current) => ({ ...current, [name]: next }));
  }, []);

  const backlogRoots = useMemo(
    () => Object.entries(roots).filter(([name]) => !layout.noBacklog.includes(name)).map(([, root]) => root).sort(),
    [roots, layout.noBacklog],
  );
  const data = useBoardData(props, backlogRoots);
  const backlogOf = (name: string) => (roots[name] && !layout.noBacklog.includes(name) ? (data.backlogs.get(roots[name]) ?? null) : null);

  const reporters = (
    <>
      {localWorkspaces.map((reference) => (
        <ProjectRoot key={reference.key} reference={reference} onRoot={onRoot} />
      ))}
      {groups.map((group) => (
        <ProjectCounter key={group.name} group={group} data={data} onCounts={onCounts} />
      ))}
    </>
  );

  if (editing) {
    return (
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        {reporters}
        <LayoutEditor
          names={groups.map((g) => g.name)}
          withBacklog={new Set(Object.keys(roots).filter((name) => data.backlogs.has(roots[name]) || layout.noBacklog.includes(name)))}
          styles={styles}
          onDone={() => setEditing(false)}
        />
      </ScrollView>
    );
  }

  const rank = (name: string) => {
    const index = layout.order.indexOf(name);
    return index === -1 ? Number.MAX_SAFE_INTEGER : index;
  };
  const sorted = [...groups].sort(
    (a, b) =>
      (layout.sort === "waiting" ? (counts[b.name]?.needsYou ?? 0) - (counts[a.name]?.needsYou ?? 0) : 0) ||
      rank(a.name) - rank(b.name) ||
      (counts[b.name]?.total ?? 0) - (counts[a.name]?.total ?? 0) ||
      a.name.localeCompare(b.name),
  );
  // A hidden project comes back while one of its sessions waits on the owner.
  const shown = sorted.filter((g) => !layout.hidden.includes(g.name) || (counts[g.name]?.needsYou ?? 0) > 0);
  const empty = shown.filter((g) => (counts[g.name]?.total ?? 0) === 0 && !layout.kinds[g.name]);
  const active = shown.filter((g) => !empty.includes(g));
  // Without a chosen kind, a BMAD project or one with 3+ sessions is shown as a table.
  const isDev = (g: ProjectGroup) => layout.kinds[g.name] === "dev" || (!layout.kinds[g.name] && (!!backlogOf(g.name) || (counts[g.name]?.total ?? 0) >= 3));
  const dev = active.filter(isDev);
  const side = active.filter((g) => !isDev(g));
  const backlogs = shown.map((g) => ({ name: g.name, backlog: backlogOf(g.name) })).filter((e): e is { name: string; backlog: Backlog } => !!e.backlog);
  const wide = !styles.compact;

  const projects = (
    <View style={{ gap: 24, flex: wide ? 1.55 : undefined, minWidth: 0 }}>
      {dev.length > 0 ? (
        <Section title={Object.values(layout.kinds).includes("dev") ? "Projekty deweloperskie" : "Projekty"} styles={styles}>
          {dev.map((group) => (
            <ProjectTable
              key={group.name}
              group={group}
              props={props}
              styles={styles}
              data={data}
              counts={counts[group.name]}
              backlog={backlogOf(group.name)}
              root={roots[group.name]}
              collapsed={layout.collapsed.includes(group.name)}
            />
          ))}
        </Section>
      ) : null}
      {side.length > 0 || empty.length > 0 ? (
        <Section title={Object.values(layout.kinds).includes("side") ? "Projekty poboczne" : "Pozostałe projekty"} styles={styles}>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
            {side.map((group) => (
              <ProjectTile key={group.name} group={group} props={props} styles={styles} data={data} counts={counts[group.name]} />
            ))}
            {empty.length > 0 ? (
              <View style={[styles.card, { flexGrow: 1, flexBasis: 240, minWidth: 220, gap: 6 }]}>
                <View style={[styles.row, { justifyContent: "space-between" }]}>
                  <Text style={styles.strong}>Bez sesji</Text>
                  <Text style={styles.muted}>{empty.length}</Text>
                </View>
                <Text style={styles.muted}>{empty.map((g) => g.name).join(" · ")}</Text>
              </View>
            ) : null}
          </View>
        </Section>
      ) : null}
    </View>
  );

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      {reporters}
      <Header props={props} styles={styles} data={data} onEdit={() => setEditing(true)} />
      <NeedsYou props={props} styles={styles} data={data} />
      <View style={{ flexDirection: wide ? "row" : "column", gap: 24, alignItems: "flex-start" }}>
        {projects}
        {backlogs.length > 0 ? (
          <View style={{ gap: 24, flex: wide ? 1 : undefined, minWidth: wide ? 360 : undefined, width: wide ? undefined : "100%" }}>
            {backlogs.map(({ name, backlog }) => (
              <BacklogTile key={name} name={name} backlog={backlog} styles={styles} props={props} />
            ))}
          </View>
        ) : null}
      </View>
    </ScrollView>
  );
}
