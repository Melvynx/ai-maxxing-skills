import { z } from "zod";

const asText = (value: unknown) => (typeof value === "number" ? String(value) : value);

/**
 * The Chat page's URL: `c` the open conversation, `s` a Hermes session to read, `q` the search in the list, `list=1` the list open as a sheet on a
 * phone. An old or broken link still opens (each param falls back to its default, left out of the URL).
 */
export const ChatSearchSchema = z.object({
  c: z.string().regex(/^c_[0-9a-f]{16}$/).optional().catch(undefined),
  /** A Hermes session from the Conversations page: opened read only, or as the conversation it belongs to. */
  s: z.string().regex(/^[\w.:-]{1,128}$/).optional().catch(undefined),
  q: z.preprocess(asText, z.string().max(100).optional()).catch(undefined),
  list: z.literal(1).optional().catch(undefined),
  /** `archives`: the list shows the archived conversations. */
  view: z.literal("archives").optional().catch(undefined),
  /** Dev only: `approval` or `clarify` shows a recorded run (the cards' preview). */
  demo: z.enum(["approval", "clarify", "failed"]).optional().catch(undefined),
});

export type ChatSearch = z.infer<typeof ChatSearchSchema>;
