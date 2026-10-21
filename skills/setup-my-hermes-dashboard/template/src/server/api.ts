import { getApp, type App } from "@/server/app";
import type { AuthenticatedKey, Scope } from "@/server/db/api-keys";

/** Headers on every API answer: JSON only, never cached, never framed. */
const HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
};

export const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: HEADERS });

export const fail = (status: number, code: string, message: string) => json({ error: { code, message } }, status);

type Handler = (input: { request: Request; params: Record<string, string>; app: App; key: AuthenticatedKey }) => Response | Promise<Response>;

/**
 * Bearer-key route: `Authorization: Bearer sk_dash_...` with the scope it needs. Hermes and its crons call it on
 * `http://127.0.0.1:<port>/api/v1`; from outside the server it also sits behind the gate.
 */
export function withKey(scope: Scope, handler: Handler) {
  return async ({ request, params }: { request: Request; params?: Record<string, string> }) => {
    const header = request.headers.get("authorization") ?? "";
    const token = /^Bearer\s+(\S+)$/i.exec(header)?.[1];
    if (!token) return fail(401, "unauthenticated", "Send Authorization: Bearer <key> (create one on /api-keys)");
    const app = getApp();
    const key = app.keys.authenticate(token);
    if (!key) return fail(401, "unauthenticated", "Unknown, revoked or expired key");
    if (!key.scopes.has(scope)) return fail(403, "forbidden", `This key lacks the ${scope} scope`);
    try {
      return await handler({ request, params: params ?? {}, app, key });
    } catch (error) {
      console.error(error);
      return fail(500, "internal", "Something went wrong on the dashboard");
    }
  };
}

/** Reads a JSON body of at most `limit` bytes; null when it is missing, too big or not JSON. */
export async function readJson(request: Request, limit = 200_000): Promise<unknown> {
  const text = await request.text().catch(() => "");
  if (!text || text.length > limit) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
