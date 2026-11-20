import type { PluginClientContext } from "@getpaseo/plugin/client";
import { MySessions } from "./client/my-sessions";

export default function contribute(client: PluginClientContext) {
  return client.addSidebarView({
    id: "my-sessions",
    title: "Moje sesje",
    description: "Sesje według pilności, projekty na dole",
    Component: MySessions,
  });
}
