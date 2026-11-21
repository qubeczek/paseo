import { useAgents, useRpc, useWorkspaces, type PluginWorkspaceRowBadgeItemProps } from "@getpaseo/plugin/client";
import { WorkspaceRowBadge } from "@getpaseo/plugin/client/ui";
import { useQuery } from "@tanstack/react-query";
import { ownerQuestions } from "../shared/contracts";

/** "czeka na Ciebie" on the sidebar row of a workspace whose story session parked a question to the owner. */
export function QuestionBadge({ workspaceId, host }: PluginWorkspaceRowBadgeItemProps) {
  const ask = useRpc(ownerQuestions);
  const roots = useWorkspaces({
    where: (w) => w.hostId === host.id && !w.background,
    groupBy: (w) => w.projectRootPath,
  })
    .map((group) => String(group.key))
    .sort();
  // One query for every row of this host (the plugin's query client is shared by its components).
  const { data } = useQuery({
    queryKey: ["owner.questions", host.id, roots.join("\n")],
    queryFn: () => ask({ roots }),
    refetchInterval: 60_000,
    placeholderData: (previous) => previous,
  });
  const names = data?.names ?? [];
  const waiting = useAgents({
    where: (a) =>
      a.hostId === host.id && a.workspace.id === workspaceId && !!a.title && names.includes(a.title),
  }).length;
  if (waiting === 0) return null;
  return <WorkspaceRowBadge icon="MessageCircle" label="czeka na Ciebie" tone="warning" />;
}
