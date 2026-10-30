import { HermesError, type Hermes, type Json } from "@/server/hermes";

/**
 * The Models page: which AI model Hermes answers with, which providers are connected (their models can be picked) and
 * which are not. Reads `/api/model/info` and `/api/model/options`, changes the main model with `/api/model/set`
 * (written in Hermes's config, used from the next conversation on).
 */

export interface CurrentModel {
  model: string;
  provider: string;
  /** Tokens the model reads at once; 0 when Hermes does not know. */
  context: number;
  tools: boolean;
  vision: boolean;
  reasoning: boolean;
}

export interface Provider {
  slug: string;
  name: string;
  /** Hermes has a key or a sign-in for it: its models can be picked. */
  connected: boolean;
  /** The provider of the model in use. */
  current: boolean;
  models: string[];
  /** What connecting it takes, for the providers that are not connected. */
  needs: "key" | "sign-in" | null;
}

export interface ModelsData {
  current: CurrentModel | null;
  /** Connected first (the one in use on top), then the others by name. */
  providers: Provider[];
}

const str = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const strings = (value: unknown) => (Array.isArray(value) ? value.map(str).filter(Boolean) : []);

export function toCurrent(info: unknown): CurrentModel | null {
  const data = (info ?? {}) as Json;
  const model = str(data.model);
  if (!model) return null;
  const caps = (data.capabilities ?? {}) as Json;
  const context = typeof data.effective_context_length === "number" ? data.effective_context_length : 0;
  return { model, provider: str(data.provider), context, tools: caps.supports_tools === true, vision: caps.supports_vision === true, reasoning: caps.supports_reasoning === true };
}

export function toProviders(options: unknown): Provider[] {
  const rows = Array.isArray((options as Json | null)?.providers) ? ((options as Json).providers as Json[]) : [];
  return rows
    .filter((row) => row && typeof row === "object" && str(row.slug))
    .map((row) => {
      const connected = row.authenticated === true;
      const auth = str(row.auth_type);
      return {
        slug: str(row.slug),
        name: str(row.name) || str(row.slug),
        connected,
        current: row.is_current === true,
        models: strings(row.models),
        needs: connected ? null : auth.startsWith("oauth") ? ("sign-in" as const) : ("key" as const),
      };
    })
    .sort((a, b) => Number(b.connected) - Number(a.connected) || Number(b.current) - Number(a.current) || (a.connected ? 0 : a.name.localeCompare(b.name)));
}

export async function readModels(hermes: Hermes): Promise<ModelsData> {
  const [info, options] = await Promise.all([hermes.api("/api/model/info").catch(() => null), hermes.api("/api/model/options?include_unconfigured=true")]);
  return { current: toCurrent(info), providers: toProviders(options) };
}

/** `confirm`: Hermes warns before an expensive model; the page shows its message and asks again with `confirmed`. */
export type ChooseAnswer = { ok: true } | { ok: false; confirm: string };

export async function chooseModel(hermes: Hermes, input: { provider: string; model: string; confirmed: boolean }): Promise<ChooseAnswer> {
  // Only a model Hermes itself offers for a connected provider.
  const provider = toProviders(await hermes.api("/api/model/options")).find((row) => row.slug === input.provider);
  if (!provider?.connected || !provider.models.includes(input.model)) throw new HermesError("This model is not available");
  const answer = await hermes.send<Json>("POST", "/api/model/set", {
    scope: "main",
    provider: input.provider,
    model: input.model,
    confirm_expensive_model: input.confirmed,
  });
  if (answer.confirm_required === true) return { ok: false, confirm: str(answer.confirm_message) || "This model costs more. Use it anyway?" };
  if (answer.ok === false) throw new HermesError(str(answer.error) || str(answer.detail) || "Hermes did not change the model");
  return { ok: true };
}
