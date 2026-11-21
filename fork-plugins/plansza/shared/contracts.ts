import { defineRpc, defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

/** One phase row of a story flow file (`| # | Faza | Status | … |`). */
const PhaseSchema = z.object({ id: z.string(), name: z.string(), status: z.string() });

const StorySchema = z.object({
  key: z.string(),
  short: z.string(),
  title: z.string().nullable(),
  /** Phase in progress, or the next one to do; null without a flow file (old harness). */
  phase: PhaseSchema.nullable(),
  done: z.number(),
  total: z.number(),
});

const QueueItemSchema = z.object({
  short: z.string(),
  title: z.string().nullable(),
  admissible: z.boolean(),
  /** What it waits for, e.g. "PO 0-206". */
  reasons: z.array(z.string()),
  feature: z.string(),
});

export const BacklogSchema = z.object({
  root: z.string(),
  counts: z.record(z.string(), z.number()),
  inProgress: z.array(StorySchema),
  /** Null when the project has sprint-status but no PM queue script. */
  queue: z.array(QueueItemSchema).nullable(),
  /** First line of the PM run card, e.g. "2026-11-20T08:31Z (tryb SAMODZIELNY; …)". */
  pm: z.string().nullable(),
  error: z.string().nullable(),
  readAt: z.string(),
});
export type Backlog = z.infer<typeof BacklogSchema>;

export const PausedSchema = z.object({
  agentId: z.string(),
  kind: z.string(),
  resetAt: z.number().nullable(),
});
export type Paused = z.infer<typeof PausedSchema>;

/** BMAD backlogs for project roots on the plugin's host, plus sessions paused by the wznawianie plugin. */
/** A story session parked on a question to the owner (harness `story_probe.py`: WAITING_*). */
export const WaitingSchema = z.object({
  /** Session name (`--name`), equal to the Paseo agent title for sessions the harness starts. */
  name: z.string().nullable(),
  sessionId: z.string().nullable(),
  story: z.string(),
  verdict: z.string(),
  since: z.string().nullable(),
});
export type Waiting = z.infer<typeof WaitingSchema>;

export const boardStatus = defineRpc({
  name: "board.status",
  input: z.object({ roots: z.array(z.string()).max(50) }),
  output: z.object({
    backlogs: z.array(BacklogSchema),
    paused: z.array(PausedSchema),
    /** Missing from hosts with an older plugin. */
    waiting: z.array(WaitingSchema).default([]),
  }),
});

export const ProjectKindSchema = z.enum(["dev", "side"]);
export type ProjectKind = z.infer<typeof ProjectKindSchema>;

/** Board layout, shared by every client of the host: projects are keyed by display name. */
export const layoutSettings = defineSettings({
  id: "layout",
  scope: "host",
  version: 1,
  schema: z.object({
    sort: z.enum(["mine", "waiting"]).default("waiting"),
    order: z.array(z.string()).default([]),
    kinds: z.record(z.string(), ProjectKindSchema).default({}),
    hidden: z.array(z.string()).default([]),
    collapsed: z.array(z.string()).default([]),
    /** Projects whose BMAD backlog tile is turned off. */
    noBacklog: z.array(z.string()).default([]),
  }),
});
export type Layout = z.infer<typeof layoutSettings.schema>;
