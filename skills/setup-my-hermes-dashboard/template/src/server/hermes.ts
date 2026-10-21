/**
 * Read-only client of the Hermes dashboard API (`hermes dashboard`, 127.0.0.1:9119).
 * `/api/status` is open; every other endpoint wants the session token Hermes prints in its own page, which changes on
 * each restart: it is read from that page, kept in memory, and read again once when Hermes answers 401.
 * Modules read any other endpoint with `api(path)`; AGENTS.md lists the useful ones.
 */

export interface HermesStatus {
  version: string;
  overall: "ok" | "degraded" | "down" | string;
  gatewayRunning: boolean;
  /** Chat platforms the gateway is connected to (telegram, discord...). */
  platforms: string[];
  activeSessions: number;
  disk: { usedPercent: number; freeMb: number; totalMb: number } | null;
}

export class HermesError extends Error {}

const TOKEN = /__HERMES_SESSION_TOKEN__\s*=\s*"([^"]+)"/;
const TIMEOUT_MS = 4_000;

export type Json = Record<string, unknown>;

const str = (value: unknown, fallback = "") => (typeof value === "string" ? value : fallback);
const num = (value: unknown, fallback = 0) => (typeof value === "number" && Number.isFinite(value) ? value : fallback);
/** Hermes sends seconds (floats) or ISO strings; the dashboard works in milliseconds. */
export function toMs(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value < 1e12 ? value * 1000 : value);
  if (typeof value === "string" && value) {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

export class Hermes {
  private token: string | null;

  constructor(
    private readonly base: string,
    private readonly fixedToken: string | null = null,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    this.token = fixedToken;
  }

  private async request(path: string, token: string | null): Promise<Response> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (token) headers["X-Hermes-Session-Token"] = token;
    try {
      return await this.fetcher(`${this.base}${path}`, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch {
      throw new HermesError("Hermes is not answering");
    }
  }

  private async readToken(): Promise<string> {
    if (this.fixedToken) return this.fixedToken;
    const page = await this.request("/", null);
    const match = page.ok ? TOKEN.exec(await page.text()) : null;
    if (!match) throw new HermesError("Hermes did not share its session");
    this.token = match[1]!;
    return this.token;
  }

  /** GET any Hermes endpoint with the session token, e.g. `api<Json[]>("/api/cron/jobs")`. */
  async api<T = unknown>(path: string): Promise<T> {
    return this.get<T>(path);
  }

  private async get<T>(path: string, auth = true): Promise<T> {
    let response = await this.request(path, auth ? (this.token ?? (await this.readToken())) : null);
    if (auth && response.status === 401 && !this.fixedToken) response = await this.request(path, await this.readToken());
    if (!response.ok) throw new HermesError(`Hermes answered ${response.status} on ${path}`);
    return (await response.json()) as T;
  }

  async status(): Promise<HermesStatus> {
    const data = await this.get<Json>("/api/status", false);
    const disk = (data.disk ?? null) as Json | null;
    return {
      version: str(data.version, "unknown"),
      overall: str(data.overall, "unknown"),
      gatewayRunning: data.gateway_running === true,
      platforms: Object.keys((data.gateway_platforms as Json | null) ?? {}),
      activeSessions: num(data.active_sessions),
      disk: disk ? { usedPercent: num(disk.used_percent), freeMb: num(disk.free_mb), totalMb: num(disk.total_mb) } : null,
    };
  }

  async model(): Promise<string | null> {
    const data = await this.get<Json>("/api/model/info");
    return str(data.model) || null;
  }
}
