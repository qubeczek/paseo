import type { PluginClientContext, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { Board } from "./client/board";

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
  client.addScreen({ id: "board", title: "Plansza", Component: Board });
  client.addSidebarHeaderItem({ id: "board", title: "Plansza", Component: BoardItem });
  return () => {};
}
