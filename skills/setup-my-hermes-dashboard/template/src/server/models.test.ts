import { describe, expect, it } from "vitest";

import { Hermes } from "./hermes";
import { chooseModel, toCurrent, toProviders } from "./models";

const OPTIONS = {
  model: "claude-opus-5-5",
  provider: "anthropic",
  providers: [
    { slug: "nous", name: "Nous Portal", authenticated: true, is_current: false, models: ["anthropic/claude-opus-5.5", "openai/gpt-6-astra"] },
    { slug: "openrouter", name: "OpenRouter", authenticated: false, auth_type: "api_key", models: [] },
    { slug: "anthropic", name: "Anthropic", authenticated: true, is_current: true, models: ["claude-opus-5-5", "claude-sonnet-5"] },
    { slug: "codex", name: "Codex", authenticated: false, auth_type: "oauth_external", models: [] },
    { name: "No slug" },
  ],
};

/** A fake Hermes dashboard API: answers the options and records what is sent to /api/model/set. */
function fakeHermes(setAnswer: (body: Record<string, unknown>) => unknown) {
  const sent: Record<string, unknown>[] = [];
  const fetcher = (async (url: string, init?: RequestInit) => {
    const path = new URL(url).pathname;
    if (path === "/api/model/options") return Response.json(OPTIONS);
    if (path === "/api/model/set") {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      sent.push(body);
      return Response.json(setAnswer(body));
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  return { hermes: new Hermes("http://hermes.test", "token", fetcher), sent };
}

describe("models", () => {
  it("reads the model in use with what it can do", () => {
    expect(
      toCurrent({
        model: "claude-opus-5-5",
        provider: "anthropic",
        effective_context_length: 1_000_000,
        capabilities: { supports_tools: true, supports_vision: true, supports_reasoning: false },
      }),
    ).toEqual({ model: "claude-opus-5-5", provider: "anthropic", context: 1_000_000, tools: true, vision: true, reasoning: false });
    expect(toCurrent({ model: "" })).toBeNull();
    expect(toCurrent(null)).toBeNull();
  });

  it("lists connected providers first (the one in use on top), then the others by name with what they need", () => {
    const providers = toProviders(OPTIONS);
    expect(providers.map((p) => p.slug)).toEqual(["anthropic", "nous", "codex", "openrouter"]);
    expect(providers[0]).toMatchObject({ connected: true, current: true, needs: null, models: ["claude-opus-5-5", "claude-sonnet-5"] });
    expect(providers.find((p) => p.slug === "codex")?.needs).toBe("sign-in");
    expect(providers.find((p) => p.slug === "openrouter")?.needs).toBe("key");
    expect(toProviders({ providers: "nope" })).toEqual([]);
  });

  it("changes the main model, and passes Hermes's warning on an expensive one", async () => {
    const { hermes, sent } = fakeHermes((body) =>
      body.confirm_expensive_model ? { ok: true } : { ok: false, confirm_required: true, confirm_message: "This model is expensive" },
    );
    expect(await chooseModel(hermes, { provider: "nous", model: "openai/gpt-6-astra", confirmed: false })).toEqual({ ok: false, confirm: "This model is expensive" });
    expect(await chooseModel(hermes, { provider: "nous", model: "openai/gpt-6-astra", confirmed: true })).toEqual({ ok: true });
    expect(sent.at(-1)).toEqual({ scope: "main", provider: "nous", model: "openai/gpt-6-astra", confirm_expensive_model: true });
  });

  it("refuses a model Hermes does not offer, or a provider that is not connected", async () => {
    const { hermes, sent } = fakeHermes(() => ({ ok: true }));
    await expect(chooseModel(hermes, { provider: "anthropic", model: "made-up-model", confirmed: false })).rejects.toThrow("not available");
    await expect(chooseModel(hermes, { provider: "openrouter", model: "x", confirmed: false })).rejects.toThrow("not available");
    expect(sent).toEqual([]);
  });
});
