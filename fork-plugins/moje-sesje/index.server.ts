import type { PluginServerContext } from "@getpaseo/plugin/server";
import { questionsIn } from "./server/probe";
import { ownerQuestions } from "./shared/contracts";

export default function contribute(server: PluginServerContext) {
  server.handle(ownerQuestions, async ({ roots }) => ({
    names: [...new Set((await Promise.all([...new Set(roots)].map(questionsIn))).flat())],
  }));
  return () => {};
}
