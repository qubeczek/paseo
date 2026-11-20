import type { PluginServerContext } from "@getpaseo/plugin/server";

// Claude Code turns Artifact off in SDK mode unless CLAUDE_CODE_ARTIFACT is set (checked on 2.1.329).
export default function contribute(server: PluginServerContext) {
  return server.addHook("agent.open.before", async ({ request }) => {
    if (request.provider !== "claude" || request.env?.CLAUDE_CODE_ARTIFACT !== undefined) return request;
    return { ...request, env: { ...request.env, CLAUDE_CODE_ARTIFACT: "1" } };
  });
}
