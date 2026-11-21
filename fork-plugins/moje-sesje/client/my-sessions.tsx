import { useQuery } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useMemo } from "react";
import { Linking, Pressable, ScrollView, Text, View } from "react-native";
import type { PluginAgentSnapshot } from "@getpaseo/plugin";
import {
  useAgent,
  useAgents,
  useProject,
  useProjects,
  useRpc,
  useWorkspace,
  useWorkspaces,
  type AgentRef,
  type ProjectRef,
  type PluginSidebarViewProps,
} from "@getpaseo/plugin/client";

import { ownerQuestions } from "../shared/contracts";

type Bucket = "waiting" | "working" | "recent";

/** Titles of sessions parked on a question to the owner (harness probe); Paseo itself cannot see these. */
const Questions = createContext<ReadonlySet<string>>(new Set());
const asked = (agent: PluginAgentSnapshot, questions: ReadonlySet<string>) =>
  !!agent.title && questions.has(agent.title);

const RECENT_LIMIT = 15;

/** Where an agent belongs in the list: what it needs from the user right now. */
function bucketOf(agent: PluginAgentSnapshot, questions: ReadonlySet<string>): Bucket {
  if (agent.attentionReason === "permission" || agent.status === "error" || asked(agent, questions)) return "waiting";
  if (
    agent.status === "running" ||
    agent.status === "initializing" ||
    agent.backgroundWork.count > 0
  )
    return "working";
  // A finished turn is not waiting for the owner: story sessions finish turns for their PM all the
  // time. Only a permission request or an error needs the owner; the rest is listed as recent.
  return "recent";
}

function waitingLabel(agent: PluginAgentSnapshot, questions: ReadonlySet<string>): string {
  if (agent.attentionReason === "permission") return "prosi o zgodę";
  if (asked(agent, questions)) return "czeka na Twoją decyzję";
  return "błąd";
}

function relativeTime(iso: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  if (minutes < 1) return "teraz";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} godz.`;
  return `${Math.round(hours / 24)} dn.`;
}

function Heading({ title, count, view }: { title: string; count?: number; view: PluginSidebarViewProps }) {
  const style = useMemo(
    () => ({
      color: view.theme.colors.foregroundMuted,
      fontSize: 11,
      fontWeight: "600" as const,
      letterSpacing: 0.5,
      paddingHorizontal: 16,
      paddingTop: 16,
      paddingBottom: 6,
    }),
    [view.theme],
  );
  return (
    <Text accessibilityRole="header" style={style}>
      {count === undefined ? title : `${title} · ${count}`}
    </Text>
  );
}

function Place({ agent }: { agent: PluginAgentSnapshot }) {
  const workspace = useWorkspace(agent.workspace);
  if (!workspace) return <>{agent.cwd}</>;
  const name = workspace.title ?? workspace.name;
  return (
    <>
      {workspace.projectDisplayName}
      {name && name !== workspace.projectDisplayName ? ` / ${name}` : ""}
    </>
  );
}

/** Set by the Claude provider once the session is registered with Remote Control. */
function remoteControlUrl(agent: PluginAgentSnapshot): string | null {
  const url = agent.metadata.remoteControlUrl;
  return typeof url === "string" && url.startsWith("https://") ? url : null;
}

function RemoteControlLink({ agent, view }: { agent: PluginAgentSnapshot; view: PluginSidebarViewProps }) {
  const url = remoteControlUrl(agent);
  const open = useCallback(() => {
    if (url) void Linking.openURL(url);
  }, [url]);
  if (!url || agent.status === "closed") return null;
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel="Otwórz w Claude"
      onPress={open}
      hitSlop={8}
      style={{
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: view.theme.colors.border,
      }}
    >
      <Text style={{ color: view.theme.colors.foregroundMuted, fontSize: 11 }}>Claude ↗</Text>
    </Pressable>
  );
}

function AgentRow({ reference, view }: { reference: AgentRef; view: PluginSidebarViewProps }) {
  const agent = useAgent(reference);
  const open = useCallback(() => view.navigation.openAgent(reference), [view.navigation, reference]);
  const colors = view.theme.colors;
  const questions = useContext(Questions);
  if (!agent) return null;
  const bucket = bucketOf(agent, questions);
  const dot =
    bucket === "waiting"
      ? agent.status === "error"
        ? colors.statusDanger
        : colors.statusWarning
      : bucket === "working"
        ? colors.accent
        : colors.foregroundMuted;
  const state =
    bucket === "waiting"
      ? waitingLabel(agent, questions)
      : bucket === "working"
        ? agent.status === "running" || agent.status === "initializing"
          ? "pracuje"
          : `${agent.backgroundWork.count} zad. w tle`
        : agent.attentionReason === "finished"
          ? `skończył · ${relativeTime(agent.lastActivityAt)}`
          : relativeTime(agent.lastActivityAt);
  const active = view.active.agent?.key === reference.key;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Otwórz ${agent.title ?? agent.provider}`}
      onPress={open}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        minHeight: 44,
        paddingHorizontal: 16,
        paddingVertical: 6,
        backgroundColor: active ? colors.surface2 : undefined,
      }}
    >
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: dot }} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 15 }}>
          {agent.title ?? "Bez tytułu"}
        </Text>
        <Text numberOfLines={1} style={{ color: colors.foregroundMuted, fontSize: 12 }}>
          <Place agent={agent} /> · {agent.provider} · {state}
        </Text>
      </View>
      <RemoteControlLink agent={agent} view={view} />
    </Pressable>
  );
}

function Section({
  title,
  bucket,
  limit,
  empty,
  view,
}: {
  title: string;
  bucket: Bucket;
  limit?: number;
  empty?: string;
  view: PluginSidebarViewProps;
}) {
  const questions = useContext(Questions);
  // Background agents are helpers the user never opens; subagents live under their parent.
  const agents = useAgents({
    where: (agent) => !agent.background && agent.parentAgentId === null && bucketOf(agent, questions) === bucket,
    orderBy: ["lastActivityAt", "desc"],
  });
  const shown = limit === undefined ? agents : agents.slice(0, limit);
  if (shown.length === 0 && !empty) return null;
  return (
    <View>
      <Heading title={title} count={agents.length} view={view} />
      {shown.length === 0 ? (
        <Text style={{ color: view.theme.colors.foregroundMuted, fontSize: 13, paddingHorizontal: 16 }}>
          {empty}
        </Text>
      ) : (
        shown.map((reference) => <AgentRow key={reference.key} reference={reference} view={view} />)
      )}
    </View>
  );
}

function ProjectRow({ reference, view }: { reference: ProjectRef; view: PluginSidebarViewProps }) {
  const project = useProject(reference);
  const open = useCallback(() => view.navigation.openProject(reference), [view.navigation, reference]);
  if (!project) return null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Nowa sesja w ${project.displayName}`}
      onPress={open}
      style={{ flexDirection: "row", alignItems: "center", minHeight: 40, paddingHorizontal: 16 }}
    >
      <Text numberOfLines={1} style={{ flex: 1, color: view.theme.colors.foreground, fontSize: 14 }}>
        {project.displayName}
      </Text>
      <Text style={{ color: view.theme.colors.foregroundMuted, fontSize: 18 }}>+</Text>
    </Pressable>
  );
}

function Projects({ view }: { view: PluginSidebarViewProps }) {
  const projects = useProjects({ orderBy: "displayName" });
  if (projects.length === 0) return null;
  return (
    <View>
      <Heading title="NOWA SESJA W PROJEKCIE" view={view} />
      {projects.map((reference) => (
        <ProjectRow key={reference.key} reference={reference} view={view} />
      ))}
    </View>
  );
}

function useOwnerQuestions(): ReadonlySet<string> {
  const ask = useRpc(ownerQuestions);
  const workspaces = useWorkspaces({ where: (w) => !w.background, groupBy: (w) => w.projectRootPath });
  const roots = workspaces.map((group) => String(group.key)).sort();
  const query = useQuery({
    queryKey: ["owner.questions", roots.join("\n")],
    queryFn: () => ask({ roots }),
    refetchInterval: 60_000,
    placeholderData: (previous) => previous,
  });
  const names = query.data?.names;
  return useMemo(() => new Set(names ?? []), [names?.join("\n")]);
}

export function MySessions(view: PluginSidebarViewProps) {
  const questions = useOwnerQuestions();
  return (
    <Questions.Provider value={questions}>
    <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
      <Section title="CZEKA NA CIEBIE" bucket="waiting" empty="Nic nie czeka." view={view} />
      <Section title="PRACUJE" bucket="working" view={view} />
      <Section title="OSTATNIE" bucket="recent" limit={RECENT_LIMIT} view={view} />
      <Projects view={view} />
    </ScrollView>
    </Questions.Provider>
  );
}
