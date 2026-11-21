import type { PluginClientContext } from "@getpaseo/plugin/client";
import { MySessions } from "./client/my-sessions";
import { QuestionBadge } from "./client/question-badge";

export default function contribute(client: PluginClientContext) {
  const removers = [
    client.addSidebarView({
      id: "my-sessions",
      title: "Moje sesje",
      description: "Sesje według pilności, projekty na dole",
      Component: MySessions,
    }),
  ];
  // Apps older than this API have no addWorkspaceRowBadgeItem.
  if (typeof client.addWorkspaceRowBadgeItem === "function") {
    removers.push(
      client.addWorkspaceRowBadgeItem({
        id: "owner-question",
        title: "Czeka na Ciebie (pytanie story)",
        icon: "MessageCircle",
        Component: QuestionBadge,
      }),
    );
  }
  return () => {
    for (const remove of removers) remove();
  };
}
