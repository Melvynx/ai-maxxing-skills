import { createFileRoute, useRouter } from "@tanstack/react-router";
import { CircleAlert } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { AdminsOnly, Empty, Page, Table } from "@/components/hub/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Access } from "@/server/gate";
import { addMember, getTeam, removeMember, type TeamPage as TeamData } from "@/server/functions";

export const Route = createFileRoute("/team")({
  loader: () => getTeam(),
  head: () => ({ meta: [{ title: "Team · Hermes" }] }),
  component: TeamPage,
});

const HINT = "Who can sign in to this dashboard, and what each role sees.";

const ROLES = [
  { role: "Admin", sees: "Everything: every module, System monitoring, the API keys and this page." },
  { role: "Member", sees: "Every module. Not System monitoring, the API keys or this page." },
] as const;

function TeamPage() {
  const team = Route.useLoaderData();
  if (!team) {
    return (
      <AdminsOnly title="The team is managed by admins" testId="team-admins-only">
        Ask the owner of this dashboard to add or remove someone.
      </AdminsOnly>
    );
  }
  return (
    <Page section="team" hint={HINT} testId="team">
      <div className="grid gap-6">
        {team.users ? <TeamManager team={team} users={team.users} /> : <AskHermes />}
        <RolesLegend />
      </div>
    </Page>
  );
}

/** The gate cannot be asked from here (see src/server/gate.ts): the owner changes access through Hermes or the server. */
function AskHermes() {
  return (
    <section className="grid gap-2 rounded-xl border bg-card p-4 shadow-panel" role="status" data-testid="team-unavailable">
      <p className="flex items-center gap-2 text-sm font-medium">
        <CircleAlert className="size-4 text-warn" aria-hidden /> The access list cannot be read from here
      </p>
      <p className="text-sm text-muted-foreground">
        Ask Hermes: <span className="text-foreground">"add bob@example.com to the dashboard"</span>. Or run{" "}
        <code className="font-mono text-xs">sudo expose user add bob@example.com member --invite</code> on the server (
        <code className="font-mono text-xs">sudo expose user list</code> to see who has access).
      </p>
    </section>
  );
}

function RolesLegend() {
  return (
    <section className="grid gap-2">
      <h2 className="font-medium">Roles</h2>
      <dl className="grid gap-2 sm:grid-cols-2">
        {ROLES.map(({ role, sees }) => (
          <div key={role} className="grid gap-1 rounded-xl border bg-card p-4 shadow-panel">
            <dt className="text-sm font-medium">{role}</dt>
            <dd className="text-sm text-muted-foreground">{sees}</dd>
          </div>
        ))}
      </dl>
      <p className="text-xs text-muted-foreground">New people join as members. To make someone an admin, ask Hermes.</p>
    </section>
  );
}

function TeamManager({ team, users }: { team: TeamData; users: Access[] }) {
  const router = useRouter();
  const [email, setEmail] = React.useState("");
  const [invite, setInvite] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [armed, setArmed] = React.useState<string | null>(null);

  async function add(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await addMember({ data: { email: email.trim(), invite } });
      if (result.ran) toast.success(invite ? `${email.trim()} can sign in, invite sent` : `${email.trim()} can sign in`);
      else toast.message("Dry run: nothing changed", { description: result.command.join(" ") });
      setEmail("");
      await router.invalidate();
    } catch (error) {
      toast.error(errorText(error, "Could not add this person"));
    } finally {
      setBusy(false);
    }
  }

  async function remove(address: string) {
    if (armed !== address) return setArmed(address);
    setArmed(null);
    try {
      const result = await removeMember({ data: { email: address } });
      if (result.ran) toast.success(`${address} can no longer sign in`);
      else toast.message("Dry run: nothing changed", { description: result.command.join(" ") });
      await router.invalidate();
    } catch (error) {
      toast.error(errorText(error, "Could not remove this person"));
    }
  }

  const you = team.you?.toLowerCase() ?? null;
  const valid = /^\S+@\S+\.\S+$/.test(email.trim());

  return (
    <>
      {team.mode === "dry-run" ? (
        <p className="rounded-xl border border-brand/40 bg-brand/5 px-4 py-3 text-sm" data-testid="team-dry-run">
          Dry run (<code className="font-mono text-xs">GATE_COMMANDS=dry-run</code>): changes only show the command they would run.
        </p>
      ) : null}

      <form onSubmit={add} className="grid gap-4 rounded-xl border bg-card p-4 shadow-panel" data-testid="team-add">
        <h2 className="font-medium">Add a member</h2>
        <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
          <Input type="email" placeholder="Email, e.g. bob@example.com" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={160} aria-label="Email" />
          <Button type="submit" disabled={!valid || busy}>
            {busy ? "Adding…" : "Add member"}
          </Button>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={invite} onChange={(e) => setInvite(e.target.checked)} />
          Email them an invite with the link
        </label>
      </form>

      <section className="grid gap-2">
        <h2 className="font-medium">Who can sign in</h2>
        {users.length === 0 ? (
          <Empty title="Nobody yet">Only a saved IP address can open the dashboard.</Empty>
        ) : (
          <Table head={["Email", "Role", ""]}>
            {users.map((user) => (
              <tr key={user.email} data-testid="team-user">
                <td className="px-3 py-2.5">
                  {user.email}
                  {user.email === you ? <span className="ml-2 text-xs text-muted-foreground">(you)</span> : null}
                </td>
                <td className="px-3 py-2.5">
                  <Badge variant={user.role === "admin" ? "default" : "secondary"}>{user.role === "admin" ? "Admin" : "Member"}</Badge>
                </td>
                <td className="px-3 py-2.5 text-right">
                  {user.role === "member" && user.email !== you ? (
                    <Button size="sm" variant={armed === user.email ? "destructive" : "outline"} onClick={() => void remove(user.email)} onBlur={() => setArmed(null)}>
                      {armed === user.email ? "Confirm remove" : "Remove"}
                    </Button>
                  ) : null}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </section>
    </>
  );
}

/** The server's reason ("bob@example.com has no access"), or a plain fallback. */
function errorText(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : "";
  // A refused input comes back as zod's list of issues: keep the first one ("Not a valid email address").
  try {
    return (JSON.parse(message) as { message?: string }[])[0]?.message ?? fallback;
  } catch {
    return message || fallback;
  }
}
