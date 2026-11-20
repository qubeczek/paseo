// Fork-only app API (qubeczek/paseo web GUI): call this plugin on any host. Undefined in apps from the stores.
import type { PluginRpcContract } from "@getpaseo/plugin";
import * as pluginClient from "@getpaseo/plugin/client";
import type { input as ZodInput, output as ZodOutput, ZodType } from "zod";

export type CallHostRpc = <I extends ZodType, O extends ZodType>(
  serverId: string,
  contract: PluginRpcContract<I, O>,
  input: ZodInput<I>,
) => Promise<ZodOutput<O>>;

export const callHostRpc = (pluginClient as { callHostRpc?: CallHostRpc }).callHostRpc;
export const ALL_HOSTS = typeof callHostRpc === "function";
