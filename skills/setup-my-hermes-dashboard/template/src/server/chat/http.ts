import { z } from "zod";

import { REASONING } from "@/lib/chat/items";
import { fail, json, readJson } from "@/server/api";
import type { Viewer } from "@/server/viewer";

import type { Chat } from "./chat";
import { saveChatFile } from "./files";
import { ChatError } from "./hermes-api";

/**
 * The Chat's HTTP routes (src/routes/api/hermes-chat): the browser talks to these, never to Hermes. Admins only,
 * each person only reaches their own conversations and runs; Hermes's key stays here.
 */

export const SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  // no-transform: no proxy may compress or buffer the stream; X-Accel-Buffering for the nginx-style ones.
  "Cache-Control": "no-cache, no-transform",
  "X-Accel-Buffering": "no",
  "X-Content-Type-Options": "nosniff",
};

const ID = z.string().regex(/^c_[0-9a-f]{16}$/);
const RUN = /^run_[0-9a-f]{8,64}$/;

export const ChoiceSchema = z.object({
  provider: z.string().regex(/^[\w.:-]{1,80}$/),
  model: z.string().regex(/^[\w.:/@+-]{1,200}$/),
  reasoning: z.enum(REASONING).default("default"),
});

const StartSchema = z.object({
  conversationId: ID.nullable().default(null),
  text: z.string().max(100_000).default(""),
  images: z.array(z.object({ data: z.string().max(4_200_000), thumb: z.string().max(200_000) })).max(4).default([]),
  choice: ChoiceSchema.nullable().default(null),
  mode: z.enum(["send", "regenerate", "edit"]).default("send"),
});

const ApprovalSchema = z.object({ promptId: z.string().min(1).max(256), generation: z.number().int().nonnegative(), choice: z.enum(["once", "deny"]) });
const ClarifySchema = z.object({ promptId: z.string().min(1).max(256), generation: z.number().int().nonnegative(), answer: z.string().trim().min(1).max(4_000) });

const forbidden = () => fail(403, "forbidden", "The chat is for admins only.");

/** A ChatError becomes its own status and message; anything else is logged and stays vague. */
export function chatFailure(error: unknown): Response {
  if (error instanceof ChatError) return fail(error.status, error.code, error.message);
  console.error(error);
  return fail(500, "internal", "Unexpected dashboard error.");
}

/**
 * A POST that starts or steers a run must come from the dashboard's own page: JSON (a cross-site form or a no-cors
 * fetch cannot send it without a preflight) and, when the browser says where it comes from, the same site: another
 * site never drives Hermes with the session cookie.
 */
export function crossSite(request: Request): boolean {
  if (!/^application\/json\b/i.test(request.headers.get("content-type") ?? "")) return true;
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin") return true;
  const origin = request.headers.get("origin");
  if (origin) {
    const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? new URL(request.url).host;
    try {
      if (new URL(origin).host !== host) return true;
    } catch {
      return true;
    }
  }
  return false;
}

/** The signed-in viewer, or a 401 the page shows as is (the session ended). */
export async function withViewer(viewer: () => Promise<Viewer | null>, run: (viewer: Viewer) => Promise<Response> | Response): Promise<Response> {
  const who = await viewer();
  if (!who) return fail(401, "signed_out", "Your session ended: sign in again.");
  return run(who);
}

async function guarded(viewer: Viewer, run: () => Promise<Response>, request?: Request): Promise<Response> {
  if (viewer.role !== "admin") return forbidden();
  if (request && request.method === "POST" && crossSite(request)) return fail(403, "cross_site", "Request refused: it does not come from the dashboard.");
  try {
    return await run();
  } catch (error) {
    return chatFailure(error);
  }
}

/** `POST /api/hermes-chat/runs`: `{ conversationId?, text, images?, choice?, mode? }` → `{ conversationId, runId, title, model }`. */
export function startRequest(viewer: Viewer, request: Request, chat: Chat): Promise<Response> {
  return guarded(viewer, async () => {
    const body = StartSchema.safeParse(await readJson(request, 18_000_000));
    if (!body.success) return fail(400, "invalid", "Invalid message (too big or malformed).");
    return json(await chat.start(viewer, body.data), 201);
  }, request);
}

/** `GET /api/hermes-chat/runs/<id>/events?after=<seq>` (or `Last-Event-ID`): the run's events, as SSE. */
export function eventsRequest(viewer: Viewer, request: Request, runId: string, chat: Chat): Promise<Response> {
  return guarded(viewer, async () => {
    if (!RUN.test(runId)) return fail(404, "not_found", "Unknown run.");
    const raw = new URL(request.url).searchParams.get("after") ?? request.headers.get("last-event-id");
    const after = raw && /^\d{1,9}$/.test(raw) ? Number(raw) : null;
    const stream = await chat.events(viewer, runId, after, request.signal);
    return new Response(stream, { status: 200, headers: SSE_HEADERS });
  });
}

/** `POST /api/hermes-chat/runs/<id>/stop | approval | clarify`. */
export function controlRequest(viewer: Viewer, request: Request, runId: string, action: string, chat: Chat): Promise<Response> {
  return guarded(viewer, async () => {
    if (!RUN.test(runId)) return fail(404, "not_found", "Unknown run.");
    if (action === "stop") return json(await chat.stop(viewer, runId));
    const body = await readJson(request, 20_000);
    if (action === "approval") {
      const input = ApprovalSchema.safeParse(body);
      if (!input.success) return fail(400, "invalid", "Invalid approval answer.");
      await chat.approve(viewer, runId, input.data);
      return json({ ok: true });
    }
    if (action === "clarify") {
      const input = ClarifySchema.safeParse(body);
      if (!input.success) return fail(400, "invalid", "Empty or too long answer.");
      await chat.clarify(viewer, runId, input.data);
      return json({ ok: true });
    }
    return fail(404, "not_found", "Unknown action.");
  }, request);
}

const UploadSchema = z.object({ name: z.string().min(1).max(300), data: z.string().max(20_500_000) });

/** `POST /api/hermes-chat/files`: `{ name, data: base64 }` → `{ path, name, size }` (≤ 15 MB, CSV/Excel/PDF…). */
export function uploadRequest(viewer: Viewer, request: Request, dataDir: string): Promise<Response> {
  return guarded(viewer, async () => {
    const body = UploadSchema.safeParse(await readJson(request, 21_000_000));
    if (!body.success) return fail(400, "invalid", "Invalid or too big file (15 MB at most).");
    return json(saveChatFile(dataDir, body.data.name, body.data.data), 201);
  }, request);
}

