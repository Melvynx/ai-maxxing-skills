/**
 * Client of Hermes's API Server (`HERMES_API_SERVER_URL`, 127.0.0.1:8642) for the Chat: runs and their events, run
 * controls (stop, approval, clarify), sessions (create, rename, delete, messages), model options and skills. The
 * Bearer key is added here and never leaves the server: browsers only reach the dashboard's own routes.
 */

export type ChatErrorCode = "off" | "unavailable" | "busy" | "rejected" | "not_found" | "conflict" | "failed";

/** A refusal or an outage, with a sentence the page can show as is. */
export class ChatError extends Error {
  constructor(
    readonly code: ChatErrorCode,
    message: string,
    readonly status = 502,
  ) {
    super(message);
  }
}

const MESSAGES: Record<ChatErrorCode, string> = {
  off: "The chat is not set up on this server yet (HERMES_API_SERVER_KEY is missing).",
  unavailable: "Hermes does not answer. It may be stopped or restarting.",
  busy: "Hermes is already handling too many answers. Try again in a moment.",
  rejected: "Hermes refused this message.",
  not_found: "Not found on Hermes's side.",
  conflict: "Hermes refused this action for now.",
  failed: "Hermes returned an error.",
};

export const chatError = (code: ChatErrorCode, detail?: string, status?: number) =>
  new ChatError(code, detail ? `${MESSAGES[code]} (${detail})` : MESSAGES[code], status ?? STATUS[code]);

const STATUS: Record<ChatErrorCode, number> = { off: 503, unavailable: 503, busy: 429, rejected: 400, not_found: 404, conflict: 409, failed: 502 };

type Json = Record<string, unknown>;

/** Hermes's OpenAI-style error: `{ error: { message, code } }`. */
function hermesDetail(body: unknown): { code: string; message: string } {
  const error = (body as Json | null)?.error as Json | undefined;
  return { code: typeof error?.code === "string" ? error.code : "", message: typeof error?.message === "string" ? error.message : "" };
}

/** Maps an answer that is not OK to a ChatError: 429 busy, 400 refused (an image too big or not an image), 404, 409. */
export async function failure(response: Response, what: string): Promise<ChatError> {
  const body = await response.json().catch(() => null);
  const { code, message } = hermesDetail(body);
  if (response.status === 429) return chatError("busy");
  if (response.status === 400) {
    if (/image|media|content_type|invalid_params/i.test(`${code} ${message}`)) return new ChatError("rejected", "Hermes refused the image: it is too heavy or not a valid image (PNG, JPEG, GIF or WebP).", 400);
    return chatError("rejected", message || code || undefined);
  }
  if (response.status === 401 || response.status === 403) return chatError("failed", "API Server key refused", 502);
  if (response.status === 404) return chatError("not_found", what);
  if (response.status === 409) return chatError("conflict", message || code || undefined);
  if (response.status === 503) return chatError("unavailable", code || undefined);
  return chatError("failed", `${response.status} on ${what}`);
}

const TIMEOUT_MS = 15_000;

export class HermesApiServer {
  constructor(
    private readonly base: string,
    private readonly key: string | null,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  get configured() {
    return Boolean(this.key);
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    if (!this.key) throw chatError("off");
    return { Authorization: `Bearer ${this.key}`, Accept: "application/json", ...extra };
  }

  private async fetch(path: string, init: RequestInit): Promise<Response> {
    try {
      return await this.fetcher(`${this.base}${path}`, init);
    } catch (error) {
      if ((error as Error)?.name === "AbortError" && init.signal?.aborted && !(init.signal.reason instanceof DOMException && init.signal.reason.name === "TimeoutError")) throw error;
      throw chatError("unavailable");
    }
  }

  /** JSON call; `headers` adds e.g. `X-Hermes-Session-Key`. */
  async json<T = Json>(method: "GET" | "POST" | "PATCH" | "DELETE", path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
    const response = await this.fetch(path, {
      method,
      headers: this.headers(body === undefined ? headers : { ...headers, "Content-Type": "application/json" }),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw await failure(response, path);
    return (await response.json()) as T;
  }

  /** The run's SSE stream (`Last-Event-ID` resumes after an event). Aborting `signal` only detaches: the run goes on. */
  async events(runId: string, after: number | null, signal: AbortSignal): Promise<Response> {
    const headers = this.headers({ Accept: "text/event-stream" });
    if (after !== null && after >= 0) headers["Last-Event-ID"] = String(after);
    const response = await this.fetch(`/v1/runs/${encodeURIComponent(runId)}/events`, { method: "GET", headers, signal });
    if (!response.ok || !response.body) throw await failure(response, "the run events");
    return response;
  }
}
