import type {
  PluginClientContext,
  PluginScreenProps,
  PluginSidebarItemProps,
  PluginSidebarViewProps,
} from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { Board } from "./client/board";

function BoardScreen(props: PluginScreenProps) {
  return (
    <Board
      theme={props.theme}
      layout={props.layout}
      hostId={props.host.id}
      hostLabel={props.host.label}
      openAgent={(agent) => props.navigation?.openAgent({ agentId: agent.id, serverId: agent.hostId })}
    />
  );
}

/** The phone app 0.16 gives plugin screens no session state; sidebar views have it there. */
function BoardSidebarView(props: PluginSidebarViewProps) {
  return (
    <Board
      theme={props.theme}
      layout={{ ...props.layout, compact: true }}
      hostId={null}
      hostLabel=""
      openAgent={(agent) => props.navigation.openAgent(agent.ref)}
    />
  );
}

function BoardItem({ currentScreen, openScreen }: PluginSidebarItemProps) {
  return (
    <SidebarRow
      icon="LayoutDashboard"
      label="Plansza"
      active={currentScreen?.screenId === "board"}
      onPress={() => openScreen({ screenId: "board" })}
    />
  );
}

export default function contribute(client: PluginClientContext) {
  client.addScreen({ id: "board", title: "Plansza", Component: BoardScreen });
  client.addSidebarHeaderItem({ id: "board", title: "Plansza", Component: BoardItem });
  client.addSidebarView({
    id: "board-view",
    title: "Plansza",
    description: "Plansza w panelu bocznym (telefon z aplikacją 0.16)",
    Component: BoardSidebarView,
  });
  return () => {};
}
