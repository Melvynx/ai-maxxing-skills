import { createFileRoute, useRouter } from "@tanstack/react-router";
import { Copy, KeyRound } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { Empty, Table } from "@/components/hub/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { dateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { PublicKey } from "@/server/db/api-keys";
import { createKey, listKeys, revokeKey } from "@/server/functions";

export const Route = createFileRoute("/api-keys")({
  loader: () => listKeys(),
  head: () => ({ meta: [{ title: "API keys · Hermes" }] }),
  component: ApiKeysPage,
});

const SCOPES = [
  { id: "dashboard:read", label: "Read" },
  { id: "dashboard:write", label: "Write" },
] as const;

type ScopeId = (typeof SCOPES)[number]["id"];

const EXPIRIES = [
  { days: 30, label: "Expires in 30 days" },
  { days: 90, label: "Expires in 90 days" },
  { days: 365, label: "Expires in 1 year" },
  { days: null, label: "Never expires" },
] as const;

/** Keys store seconds. */
const when = (ts: number | null, fallback: string) => (ts ? dateTime(ts * 1000) : fallback);

function ApiKeysPage() {
  const keys = Route.useLoaderData();
  if (!keys) return <AdminsOnly />;
  return <KeysManager keys={keys} />;
}

function AdminsOnly() {
  return (
    <main className="mx-auto grid min-h-[60dvh] max-w-sm place-content-center justify-items-center gap-2 p-6 text-center" data-testid="api-keys-admins-only">
      <KeyRound className="mb-1 size-6 text-brand" aria-hidden />
      <h1 className="text-lg font-semibold">API keys are for admins</h1>
      <p className="text-sm text-muted-foreground">Ask the owner of this dashboard if you need one.</p>
    </main>
  );
}

function KeysManager({ keys }: { keys: PublicKey[] }) {
  const router = useRouter();
  const [name, setName] = React.useState("");
  const [expiry, setExpiry] = React.useState<number>(1);
  const [scopes, setScopes] = React.useState<ScopeId[]>(["dashboard:read", "dashboard:write"]);
  const [busy, setBusy] = React.useState(false);
  const [secret, setSecret] = React.useState<string | null>(null);
  const [armed, setArmed] = React.useState<string | null>(null);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const { token } = await createKey({ data: { name: name.trim(), scopes, days: EXPIRIES[expiry]!.days } });
      setSecret(token);
      setName("");
      await router.invalidate();
    } catch {
      toast.error("Could not create the key");
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    if (armed !== id) return setArmed(id);
    setArmed(null);
    try {
      await revokeKey({ data: { id } });
      toast.success("Key revoked");
      await router.invalidate();
    } catch {
      toast.error("Could not revoke the key");
    }
  }

  const toggle = (id: ScopeId) => setScopes((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]));
  const valid = /^[\w .@:-]{1,60}$/u.test(name.trim()) && scopes.length > 0;

  return (
    <main className="mx-auto grid w-full max-w-4xl gap-6 px-4 pt-6 pb-24 sm:px-6 sm:pt-10" data-testid="api-keys">
      <header className="grid gap-1">
        <h1 className="flex items-center gap-2 text-xl font-semibold">
          <KeyRound className="size-5 text-brand" aria-hidden /> API keys
        </h1>
        <p className="text-sm text-muted-foreground">
          Keys for <code className="font-mono text-xs">dashboard-cli</code> and agents. Hermes has its own, made on the server with{" "}
          <code className="font-mono text-xs">dashboard key</code>.
        </p>
      </header>

      {secret ? (
        <section className="grid gap-2 rounded-xl border border-brand/40 bg-brand/5 p-4" data-testid="api-key-secret">
          <p className="text-sm font-medium">New key, shown once. Copy it now.</p>
          <div className="flex gap-2">
            <Input readOnly value={secret} className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
            <Button
              type="button"
              variant="outline"
              onClick={() => void navigator.clipboard.writeText(secret).then(() => toast.success("Copied"))}
            >
              <Copy className="size-4" aria-hidden /> Copy
            </Button>
            <Button type="button" variant="ghost" onClick={() => setSecret(null)}>
              Hide
            </Button>
          </div>
        </section>
      ) : null}

      <form onSubmit={create} className="grid gap-4 rounded-xl border bg-card p-4 shadow-panel">
        <h2 className="font-medium">Generate a key</h2>
        <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
          <Input placeholder="Name, e.g. hermes" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
          <select
            className="h-9 rounded-md border bg-background px-2 text-sm"
            value={expiry}
            onChange={(e) => setExpiry(Number(e.target.value))}
            aria-label="Expiry"
          >
            {EXPIRIES.map((option, index) => (
              <option key={option.label} value={index}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <fieldset className="grid gap-2 sm:grid-cols-2">
          {SCOPES.map((scope) => (
            <label key={scope.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={scopes.includes(scope.id)} onChange={() => toggle(scope.id)} />
              {scope.label}
            </label>
          ))}
        </fieldset>
        <Button type="submit" disabled={!valid || busy} className="justify-self-start">
          {busy ? "Generating…" : "Generate key"}
        </Button>
      </form>

      <section className="grid gap-2">
        <h2 className="font-medium">Keys</h2>
        {keys.length === 0 ? (
          <Empty title="No key yet" />
        ) : (
          <Table head={["Name", "Key", "Scopes", "Last used", "Expires", ""]}>
            {keys.map((key) => (
              <tr key={key.id} className={cn(key.revokedAt && "opacity-50")}>
                <td className="px-3 py-2.5">{key.name}</td>
                <td className="px-3 py-2.5 font-mono text-xs">{key.masked}</td>
                <td className="px-3 py-2.5 text-xs">{key.scopes.join(", ")}</td>
                <td className="px-3 py-2.5 text-xs whitespace-nowrap">{when(key.lastUsedAt, "never")}</td>
                <td className="px-3 py-2.5 text-xs whitespace-nowrap">{key.revokedAt ? `Revoked ${when(key.revokedAt, "")}` : when(key.expiresAt, "never")}</td>
                <td className="px-3 py-2.5 text-right">
                  {key.revokedAt ? null : (
                    <Button size="sm" variant={armed === key.id ? "destructive" : "outline"} onClick={() => void revoke(key.id)} onBlur={() => setArmed(null)}>
                      {armed === key.id ? "Confirm revoke" : "Revoke"}
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </section>
    </main>
  );
}
