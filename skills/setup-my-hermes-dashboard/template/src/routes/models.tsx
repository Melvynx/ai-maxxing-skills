import { createFileRoute, useRouter } from "@tanstack/react-router";
import { Check, ChevronDown, Search } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { AdminsOnly, Dot, Empty, Page, Unavailable } from "@/components/hub/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { count } from "@/lib/format";
import { cn } from "@/lib/utils";
import { getModels, setModel } from "@/server/functions";
import type { CurrentModel, ModelsData, Provider } from "@/server/models";

export const Route = createFileRoute("/models")({
  loader: () => getModels(),
  head: () => ({ meta: [{ title: "Models · Hermes" }] }),
  component: ModelsPage,
});

const HINT = "The AI model Hermes answers with. A change applies from the next conversation.";
/** Models shown per provider before "Show all". */
const FIRST = 8;

function ModelsPage() {
  const data = Route.useLoaderData();
  if (!data) {
    return (
      <AdminsOnly title="Models are for admins" testId="models-admins-only">
        Changing the model changes how the agent answers for everyone.
      </AdminsOnly>
    );
  }
  if (!data.models) {
    return (
      <Page section="models" hint={HINT} testId="models">
        <Unavailable what="The models" />
      </Page>
    );
  }
  return <Models data={data.models} />;
}

function Models({ data }: { data: ModelsData }) {
  const [query, setQuery] = React.useState("");
  const needle = query.trim().toLowerCase();
  const connected = data.providers.filter((p) => p.connected);
  const others = data.providers.filter((p) => !p.connected);
  const current = data.providers.find((p) => p.current);
  const search = (
    <label className="relative w-full sm:w-64">
      <span className="sr-only">Find a model</span>
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a model" className="pl-8" data-testid="models-search" />
    </label>
  );
  return (
    <Page section="models" hint={HINT} actions={search} testId="models">
      <div className="grid gap-6">
        {data.current ? <InUse model={data.current} providerName={current?.name ?? data.current.provider} /> : <Empty title="No model set">Pick one below.</Empty>}

        <section className="grid gap-3" aria-label="Connected" data-testid="models-connected">
          <h2 className="text-sm font-semibold">
            Connected <span className="font-normal text-muted-foreground">· {connected.length}</span>
          </h2>
          {connected.length ? (
            <div className="grid gap-4 lg:grid-cols-2">
              {connected.map((provider) => (
                <ProviderCard key={provider.slug} provider={provider} inUse={data.current} needle={needle} />
              ))}
            </div>
          ) : (
            <Empty title="No provider connected">Ask Hermes to connect one, for example "connect my Anthropic account".</Empty>
          )}
        </section>

        {others.length ? <NotConnected providers={others} /> : null}
      </div>
    </Page>
  );
}

function InUse({ model, providerName }: { model: CurrentModel; providerName: string }) {
  const can = [model.tools && "Tools", model.vision && "Images", model.reasoning && "Reasoning"].filter(Boolean) as string[];
  return (
    <section className="grid gap-3 rounded-xl border border-good-line bg-good-soft p-4 shadow-panel sm:p-5" aria-label="In use" data-testid="models-current">
      <div className="flex flex-wrap items-center gap-2">
        <Dot tone="good" className="size-2.5" />
        <span className="text-xs font-medium text-good">In use</span>
      </div>
      <div className="grid gap-1">
        <p className="font-mono text-lg font-semibold break-all">{model.model}</p>
        <p className="text-sm text-muted-foreground">
          {providerName}
          {model.context ? ` · reads ${shortTokens(model.context)} tokens at once` : ""}
        </p>
      </div>
      {can.length ? (
        <div className="flex flex-wrap gap-1.5">
          {can.map((label) => (
            <Badge key={label} variant="outline" className="bg-card">
              {label}
            </Badge>
          ))}
        </div>
      ) : null}
    </section>
  );
}

const shortTokens = (value: number) => (value >= 1_000_000 ? `${+(value / 1_000_000).toFixed(1)}M` : value >= 1_000 ? `${Math.round(value / 1_000)}K` : count(value));

function ProviderCard({ provider, inUse, needle }: { provider: Provider; inUse: CurrentModel | null; needle: string }) {
  const [all, setAll] = React.useState(false);
  const matches = needle ? provider.models.filter((model) => model.toLowerCase().includes(needle)) : provider.models;
  if (needle && !matches.length) return null;
  const isUsed = (model: string) => provider.current && inUse?.model === model;
  // The model in use always shows, even past the first ones.
  const shown = all || needle ? matches : [...matches.filter(isUsed), ...matches.filter((m) => !isUsed(m))].slice(0, FIRST);
  return (
    <section className="grid content-start rounded-xl border bg-card shadow-panel" aria-label={provider.name} data-testid={`provider-${provider.slug}`}>
      <header className="flex items-center gap-2 border-b px-4 py-3">
        <h3 className="min-w-0 flex-1 truncate text-sm font-semibold">{provider.name}</h3>
        {provider.current ? <Badge variant="outline">In use</Badge> : null}
        <span className="text-xs text-muted-foreground">{count(provider.models.length)} models</span>
      </header>
      {shown.length ? (
        <ul className="divide-y">
          {shown.map((model) => (
            <ModelRow key={model} provider={provider.slug} model={model} used={isUsed(model)} />
          ))}
        </ul>
      ) : (
        <p className="px-4 py-3 text-sm text-muted-foreground">Hermes did not list its models.</p>
      )}
      {!needle && matches.length > FIRST ? (
        <button
          type="button"
          onClick={() => setAll((value) => !value)}
          className="flex items-center justify-center gap-1.5 border-t px-4 py-2.5 text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40"
        >
          {all ? "Show less" : `Show all ${count(matches.length)}`}
          <ChevronDown className={cn("size-3.5 transition-transform", all && "rotate-180")} aria-hidden />
        </button>
      ) : null}
    </section>
  );
}

function ModelRow({ provider, model, used }: { provider: string; model: string; used: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  // Hermes's warning before an expensive model: the row asks again before using it.
  const [warning, setWarning] = React.useState<string | null>(null);

  async function choose(confirmed: boolean) {
    setBusy(true);
    try {
      const answer = await setModel({ data: { provider, model, confirmed } });
      if (!answer.ok) {
        setWarning(answer.confirm);
        return;
      }
      setWarning(null);
      toast.success(`Hermes now uses ${model}`);
      await router.invalidate();
    } catch {
      toast.error("Could not change the model");
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="grid gap-2 px-4 py-2" data-testid="model-row">
      <div className="flex min-h-8 items-center gap-3">
        <span className={cn("min-w-0 flex-1 truncate font-mono text-xs", used && "font-semibold")} title={model}>
          {model}
        </span>
        {used ? (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-good">
            <Check className="size-3.5" aria-hidden /> In use
          </span>
        ) : warning ? null : (
          <Button type="button" size="sm" variant="ghost" className="h-7" onClick={() => void choose(false)} disabled={busy} data-testid="model-use">
            {busy ? "Switching…" : "Use"}
          </Button>
        )}
      </div>
      {warning ? (
        <div className="grid gap-2 rounded-lg border border-warn-line bg-warn-soft px-3 py-2" role="alert">
          <p className="text-xs text-warn">{warning}</p>
          <div className="flex gap-2">
            <Button type="button" size="sm" className="h-7" onClick={() => void choose(true)} disabled={busy}>
              {busy ? "Switching…" : "Use anyway"}
            </Button>
            <Button type="button" size="sm" variant="ghost" className="h-7" onClick={() => setWarning(null)} disabled={busy}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
    </li>
  );
}

function NotConnected({ providers }: { providers: Provider[] }) {
  return (
    <details className="group grid gap-3" data-testid="models-not-connected">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-semibold outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40 [&::-webkit-details-marker]:hidden">
        Not connected <span className="font-normal text-muted-foreground">· {providers.length}</span>
        <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <p className="mt-3 text-sm text-muted-foreground">To use one, ask Hermes, for example "connect OpenRouter". It tells you where to get the key.</p>
      {/* Each cell draws its right and bottom line; the outer frame hides the ones on its edges. */}
      <div className="mt-3 overflow-hidden rounded-xl border bg-card">
        <ul className="-mr-px -mb-px grid sm:grid-cols-2 lg:grid-cols-3">
          {providers.map((provider) => (
            <li key={provider.slug} className="flex items-center gap-2.5 border-r border-b px-4 py-2.5">
              <Dot tone="idle" />
              <span className="min-w-0 flex-1 truncate text-sm">{provider.name}</span>
              <span className="text-xs text-muted-foreground">{provider.needs === "sign-in" ? "Needs a sign-in" : "Needs a key"}</span>
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}
