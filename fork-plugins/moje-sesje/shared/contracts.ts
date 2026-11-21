import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

/** Session names of stories the harness marked as parked on a question to the owner (story_probe WAITING_*). */
export const ownerQuestions = defineRpc({
  name: "owner.questions",
  input: z.object({ roots: z.array(z.string()).max(50) }),
  output: z.object({ names: z.array(z.string()) }),
});
