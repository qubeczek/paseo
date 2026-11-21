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
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Linking, Pressable, ScrollView, Text, View } from "react-native";
import { boardStatus, layoutSettings, type Backlog, type Layout, type Waiting } from "../shared/contracts";
import { ALL_HOSTS, callHostRpc } from "./hosts";
import { LayoutEditor } from "./layout-editor";
import { projectKey, sessionState, shortPath, since, stateColor, storyOf, type SessionState, type StateKind } from "./status";

/** What the board needs from its surface: a full screen (web, app 0.17+) or a sidebar view (app 0.16). */
export interface BoardProps {
  theme: PluginScreenProps["theme"];
  layout: PluginScreenProps["layout"];
  /** Host that answers the plugin RPC; null when the surface does not say (sidebar view). */
  hostId: string | null;
  hostLabel: string;
  openAgent(agent: PluginAgentSnapshot): void;
}
type Props = BoardProps;

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

/** Host key when only the selected host answers and the surface does not say which one it is. */
const SELECTED = "*";

interface BoardData {
  /** `host|agentId` → resetAt. */
  paused: Map<string, number | null>;
  /** `host|root` → backlog. */
  backlogs: Map<string, Backlog>;
  /** `host|session name` → story parked on an owner question. */
  waiting: Map<string, Waiting>;
  /** Hosts that did not answer (offline, plugin missing). */
  failed: string[];
}

const at = (hostId: string, value: string) => `${hostId}|${value}`;

type BoardStatusOutput = import("zod").output<(typeof boardStatus)["output"]>;
type HostResult = { hostId: string; result: BoardStatusOutput | null };

/**
 * Asks every host (fork app) or the selected one for backlogs of its project roots and its paused sessions.
 * Keeps each host's last good answer while a new query runs or a host fails once, so tiles do not flicker.
 */
function useBoardData(props: Props, request: Record<string, string[]>): BoardData {
  const status = useRpc(boardStatus);
  const hosts = useHosts();
  const online = hosts.filter((h) => h.status === "online").map((h) => h.serverId).sort();
  const key = JSON.stringify([ALL_HOSTS ? online : [props.hostId], request]);
  const query = useQuery({
    queryKey: ["board.status", key],
    queryFn: async (): Promise<HostResult[]> => {
      const call = callHostRpc;
      if (!call) {
        const hostId = props.hostId ?? SELECTED;
        return [{ hostId, result: await status({ roots: request[hostId] ?? [] }).catch(() => null) }];
      }
      return Promise.all(
        online.map(async (hostId) => ({
          hostId,
          result: await call(hostId, boardStatus, { roots: request[hostId] ?? [] }).catch(() => null),
        })),
      );
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  const lastGood = useRef(new Map<string, BoardStatusOutput>());
  return useMemo(() => {
    const failed: string[] = [];
    for (const { hostId, result } of query.data ?? []) {
      if (result) lastGood.current.set(hostId, result);
      else failed.push(hostId);
    }
    const paused = new Map<string, number | null>();
    const backlogs = new Map<string, Backlog>();
    const waiting = new Map<string, Waiting>();
    for (const [hostId, result] of lastGood.current) {
      for (const entry of result.waiting ?? []) if (entry.name) waiting.set(at(hostId, entry.name), entry);
      for (const entry of result.paused) paused.set(at(hostId, entry.agentId), entry.resetAt);
      for (const backlog of result.backlogs) backlogs.set(at(hostId, backlog.root), backlog);
    }
    return { paused, backlogs, waiting, failed };
  }, [query.data]);
}

/** Paused entries come from wznawianie on the agent's own host. */
function pausedFor(agent: PluginAgentSnapshot, data: BoardData): number | null | undefined {
  for (const key of [at(agent.hostId, agent.id), at(SELECTED, agent.id)]) {
    if (data.paused.has(key)) return data.paused.get(key) ?? null;
  }
  return undefined;
}

function questionFor(agent: PluginAgentSnapshot, data: BoardData): Waiting | undefined {
  if (!agent.title) return undefined;
  return data.waiting.get(at(agent.hostId, agent.title)) ?? data.waiting.get(at(SELECTED, agent.title));
}

const stateOf = (agent: PluginAgentSnapshot, data: BoardData) =>
  sessionState(agent, pausedFor(agent, data), questionFor(agent, data));

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
  props.openAgent(agent);
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
  const name = useWorkspace(reference, projectKey);
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
    <View style={[styles.card, { backgroundColor: tint(color, 0.1), borderColor: tint(color, 0.5), ...CARD_WIDTH }]}>
      <View style={[styles.row, { justifyContent: "space-between" }]}>
        <Text style={[styles.label, { color }]}>{state.kind === "permission" ? "Prośba o zgodę" : state.kind === "question" ? "Pytanie do Ciebie" : "Błąd"}</Text>
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
        <Button label="Otwórz sesję" onPress={() => openAgent(props, agent)} styles={styles} color={color} />
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
      <Text numberOfLines={1} style={[styles.strong, { flexShrink: 1 }]}>
        {agent.title ?? "Bez tytułu"}
      </Text>
      <Text style={styles.muted}>{since(agent.updatedAt)}</Text>
    </Pressable>
  );
}

const CARD_WIDTH = { flexBasis: 300, flexGrow: 0, flexShrink: 1, minWidth: 240, maxWidth: 420 } as const;

/** One column of finished, unread sessions of one project. */
function UnreadProject({ name, items, props, styles }: { name: string; items: readonly AgentRef[]; props: Props; styles: Styles }) {
  const c = styles.c;
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, 6);
  return (
    <View style={[styles.card, { backgroundColor: tint(c.statusSuccess, 0.08), borderColor: tint(c.statusSuccess, 0.4), gap: 4 }, CARD_WIDTH]}>
      <View style={[styles.row, { justifyContent: "space-between", paddingBottom: 4 }]}>
        <Text numberOfLines={1} style={[styles.strong, { flexShrink: 1 }]}>{name}</Text>
        <Text style={[styles.label, { color: c.statusSuccess }]}>nieprzeczytane · {items.length}</Text>
      </View>
      {shown.map((reference) => (
        <UnreadLine key={reference.key} reference={reference} props={props} styles={styles} />
      ))}
      {items.length > 6 ? (
        <Pressable accessibilityRole="button" onPress={() => setAll((v) => !v)} style={{ minHeight: 32, justifyContent: "center" }}>
          <Text style={{ color: c.accent, fontSize: 13 }}>{all ? "Zwiń" : `Pokaż wszystkie (${items.length})`}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function NeedsYou({ props, styles, data }: { props: Props; styles: Styles; data: BoardData }) {
  const byWait = (a: PluginAgentSnapshot, b: PluginAgentSnapshot) =>
    stateOf(a, data).priority - stateOf(b, data).priority || Date.parse(a.updatedAt) - Date.parse(b.updatedAt);
  const waiting = useAgents({ where: (a) => visible(a) && stateOf(a, data).needsYou, orderBy: byWait });
  const paused = useAgents({ where: (a) => visible(a) && pausedFor(a, data) !== undefined });
  const groups = useProjectGroups();
  const projectOf = useMemo(() => {
    const map = new Map<string, string>();
    for (const group of groups) for (const key of group.workspaceKeys) map.set(key, group.name);
    return map;
  }, [groups]);
  // Unread sessions in one column per project; newest project first (items are newest first).
  const byProject = useAgents({
    where: (a) => visible(a) && stateOf(a, data).kind === "finished",
    orderBy: ["updatedAt", "desc"],
    groupBy: (a) => projectOf.get(a.workspace.key) ?? "Inne",
  });
  const unreadCount = byProject.reduce((sum, group) => sum + group.items.length, 0);
  return (
    <View style={{ gap: 12 }}>
      <View style={[styles.row, { gap: 12 }]}>
        <Text accessibilityRole="header" style={styles.h2}>
          Zajrzyj tutaj
        </Text>
        <Text style={styles.muted}>najdłużej czekające pierwsze</Text>
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12, alignItems: "flex-start" }}>
        {waiting.map((reference) => (
          <NeedsYouCard key={reference.key} reference={reference} props={props} styles={styles} data={data} />
        ))}
        {byProject.map((group) => (
          <UnreadProject key={group.key} name={group.key} items={group.items} props={props} styles={styles} />
        ))}
        {waiting.length === 0 && unreadCount === 0 ? (
          <View style={[styles.card, CARD_WIDTH]}>
            <Text style={styles.muted}>Nic na Ciebie nie czeka.</Text>
          </View>
        ) : null}
      </View>
      {paused.length > 0 ? (
        <Text style={styles.muted}>
          Bez alarmu: {paused.length} {paused.length === 1 ? "sesja wstrzymana" : "sesje wstrzymane"} limitem konta, wrócą same.
        </Text>
      ) : null}
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
    groupBy: projectKey,
  });
  return useMemo(
    () => groups.map((group) => ({ name: group.key, workspaceKeys: new Set(group.items.map((item) => item.key)) })),
    [groups],
  );
}

/** Where a project lives on each host: host id → project root path. */
export type ProjectPaths = Record<string, Record<string, string>>;

/** Reports the project root of a workspace (paths in the editor; the backlog RPC on the plugin's host). */
function ProjectRoot({ reference, onRoot }: { reference: WorkspaceRef; onRoot: (name: string, hostId: string, root: string) => void }) {
  const info = useWorkspace(reference, (w) => ({ name: projectKey(w), root: w.projectRootPath }));
  useEffect(() => {
    if (info) onRoot(info.name, reference.hostId, info.root);
  }, [info?.name, info?.root, reference.hostId, onRoot]);
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
  ["question", "pytanie"],
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
          {root ? <Text style={styles.muted}>{shortPath(root)}{backlog ? " · BMAD" : ""}</Text> : null}
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

function BacklogTile({ name, backlog, styles, props, collapsed }: { name: string; backlog: Backlog; styles: Styles; props: Props; collapsed: boolean }) {
  const [all, setAll] = useState(false);
  const [open, setOpen] = useState(!collapsed);
  useEffect(() => setOpen(!collapsed), [collapsed]);
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
    <View style={[styles.card, { gap: open ? 12 : 4 }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${open ? "Zwiń" : "Rozwiń"} backlog ${name}`}
        onPress={() => setOpen((v) => !v)}
        style={[styles.row, { justifyContent: "space-between", flexWrap: "wrap", minHeight: 36 }]}
      >
        <Text accessibilityRole="header" style={[styles.strong, { fontSize: 16 }]}>
          Backlog · {name}
        </Text>
        <Text style={styles.muted}>
          {backlog.inProgress.length} w toku · {counts["backlog"] ?? 0} backlog {open ? "▾" : "▸"}
        </Text>
      </Pressable>
      {open ? (
      <View style={{ gap: 12 }}>
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
              <Text numberOfLines={1} style={styles.text}>
                <Text style={styles.strong}>{story.short}</Text>
                {story.title ? <Text style={styles.muted}>  {story.title}</Text> : null}
              </Text>
              <Text numberOfLines={1} style={[styles.muted, { fontSize: 12 }]}>
                {story.phase ? `${story.phase.id} ${story.phase.name}` : story.total ? "—" : "stary harness"}
                {story.total ? ` · ${story.done}/${story.total}` : ""}
              </Text>
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
          odczyt {new Date(backlog.readAt).toTimeString().slice(0, 5)}{props.hostLabel ? ` · ${props.hostLabel}` : ""}
        </Text>
      </View>
      ) : null}
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
  const allWorkspaces = useWorkspaces({ where: (w) => !w.background && w.archivingAt === null });

  const [paths, setPaths] = useState<ProjectPaths>({});
  const onRoot = useCallback((name: string, hostId: string, root: string) => {
    setPaths((current) =>
      current[name]?.[hostId] === root ? current : { ...current, [name]: { ...current[name], [hostId]: root } },
    );
  }, []);
  // Each host's plugin reads the backlog from its own disk. Without the fork app only the selected host answers
  // (a sidebar view does not know which one: it asks for every path and keeps what that host could read).
  const candidates = useMemo(() => {
    const result: Record<string, { hostId: string; root: string }[]> = {};
    for (const [name, byHost] of Object.entries(paths)) {
      const list = Object.entries(byHost)
        .filter(([hostId]) => ALL_HOSTS || props.hostId === null || hostId === props.hostId)
        .map(([hostId, root]) => ({ hostId: ALL_HOSTS ? hostId : (props.hostId ?? SELECTED), root }));
      if (list.length > 0) result[name] = list;
    }
    return result;
  }, [paths, props.hostId]);
  const [counts, setCounts] = useState<Record<string, Counts>>({});
  const onCounts = useCallback((name: string, next: Counts) => {
    setCounts((current) => ({ ...current, [name]: next }));
  }, []);

  const request = useMemo(() => {
    const result: Record<string, string[]> = {};
    for (const [name, list] of Object.entries(candidates)) {
      if (layout.noBacklog.includes(name)) continue;
      for (const { hostId, root } of list) result[hostId] = [...new Set([...(result[hostId] ?? []), root])].sort();
    }
    return result;
  }, [candidates, layout.noBacklog]);
  const data = useBoardData(props, request);
  const roots: Record<string, string> = {};
  const backlogByName: Record<string, Backlog> = {};
  for (const [name, list] of Object.entries(candidates)) {
    const found = list.find(({ hostId, root }) => data.backlogs.has(at(hostId, root)));
    roots[name] = (found ?? list[0]).root;
    if (found) backlogByName[name] = data.backlogs.get(at(found.hostId, found.root))!;
  }
  const backlogOf = (name: string) => (!layout.noBacklog.includes(name) ? (backlogByName[name] ?? null) : null);

  const reporters = (
    <>
      {allWorkspaces.map((reference) => (
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
          paths={paths}
          withBacklog={new Set(Object.keys(roots).filter((name) => !!backlogByName[name] || layout.noBacklog.includes(name)))}
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
              <BacklogTile key={name} name={name} backlog={backlog} styles={styles} props={props} collapsed={layout.collapsed.includes(name)} />
            ))}
          </View>
        ) : null}
      </View>
    </ScrollView>
  );
}
