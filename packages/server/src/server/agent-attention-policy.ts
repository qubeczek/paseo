import type { AgentAttentionReason } from "@getpaseo/protocol/agent-attention-notification";

export const PRESENCE_THRESHOLD_MS = 180_000;

export interface ClientPresenceState {
  appVisible: boolean;
  lastActivityAtMs: number | null;
  focusedAgentId: string | null;
  focusedTerminalId: string | null;
}

export type AttentionFocusTarget = { kind: "agent"; id: string } | { kind: "terminal"; id: string };

export interface NotificationPlan {
  inAppRecipientIndex: number | null;
  shouldPush: boolean;
}

interface ComputeNotificationPlanInput {
  allStates: ClientPresenceState[];
  // A present, app-visible client focused on the attention target suppresses the
  // notification entirely. Pass null when the target should not suppress notifications.
  focusTarget: AttentionFocusTarget | null;
  // Whether a push notification is allowed when no client is present.
  pushEligible: boolean;
  nowMs: number;
}

function isFocusedOnTarget(
  state: ClientPresenceState,
  target: AttentionFocusTarget | null,
): boolean {
  if (target === null) {
    return false;
  }
  if (target.kind === "agent") {
    return state.focusedAgentId === target.id;
  }
  return state.focusedTerminalId === target.id;
}

export function computeNotificationPlan({
  allStates,
  focusTarget,
  pushEligible,
  nowMs,
}: ComputeNotificationPlanInput): NotificationPlan {
  let mostRecentPresentIndex: number | null = null;
  let mostRecentPresentAtMs = Number.NEGATIVE_INFINITY;

  for (const [clientIndex, state] of allStates.entries()) {
    const clampedActivityAtMs =
      state.lastActivityAtMs === null ? null : Math.min(state.lastActivityAtMs, nowMs);
    const isPresent =
      clampedActivityAtMs !== null && nowMs - clampedActivityAtMs <= PRESENCE_THRESHOLD_MS;

    if (!isPresent) {
      continue;
    }

    if (state.appVisible && isFocusedOnTarget(state, focusTarget)) {
      return { inAppRecipientIndex: null, shouldPush: false };
    }

    if (clampedActivityAtMs > mostRecentPresentAtMs) {
      mostRecentPresentIndex = clientIndex;
      mostRecentPresentAtMs = clampedActivityAtMs;
    }
  }

  if (mostRecentPresentIndex !== null) {
    return { inAppRecipientIndex: mostRecentPresentIndex, shouldPush: false };
  }

  return { inAppRecipientIndex: null, shouldPush: pushEligible };
}

export function isPushEligibleAttentionReason(reason: AgentAttentionReason): boolean {
  return reason !== "error";
}

/**
 * Fork: which attention reasons notify, and how long a waiting state must last before a push.
 * PASEO_NOTIFY_REASONS: comma list of finished,permission,error (unset = upstream behaviour).
 * PASEO_PUSH_DELAY_MS: a push for permission/error waits this long and is sent only if the agent
 * is still waiting; finished turns are never delayed.
 */
export interface AttentionNotifyPolicy {
  reasons: ReadonlySet<AgentAttentionReason> | null;
  pushDelayMs: number;
}

const ATTENTION_REASONS: ReadonlySet<string> = new Set(["finished", "permission", "error"]);

export function attentionNotifyPolicyFromEnv(env: NodeJS.ProcessEnv): AttentionNotifyPolicy {
  const raw = env.PASEO_NOTIFY_REASONS?.trim();
  const reasons =
    raw === undefined || raw === ""
      ? null
      : new Set(
          raw
            .split(",")
            .map((part) => part.trim())
            .filter((part): part is AgentAttentionReason => ATTENTION_REASONS.has(part)),
        );
  const delay = Number(env.PASEO_PUSH_DELAY_MS);
  return { reasons, pushDelayMs: Number.isFinite(delay) && delay > 0 ? delay : 0 };
}

export function attentionReasonNotifies(
  policy: AttentionNotifyPolicy,
  reason: AgentAttentionReason,
): boolean {
  return policy.reasons === null ? true : policy.reasons.has(reason);
}

export function attentionPushAllowed(
  policy: AttentionNotifyPolicy,
  reason: AgentAttentionReason,
): boolean {
  return policy.reasons === null
    ? isPushEligibleAttentionReason(reason)
    : policy.reasons.has(reason);
}
