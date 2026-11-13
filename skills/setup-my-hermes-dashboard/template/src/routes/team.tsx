import { createFileRoute, useRouter } from "@tanstack/react-router";
import * as React from "react";
import { toast } from "sonner";

import { AdminsOnly, Empty, Page, Table } from "@/components/hub/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
        <TeamManager team={team} />
        <RolesLegend />
      </div>
    </Page>
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
      <p className="text-xs text-muted-foreground">
        New people join as members. To make someone an admin, ask Hermes (it runs <code className="font-mono">dashboard member add &lt;email&gt; admin</code> on the server).
      </p>
    </section>
  );
}

function TeamManager({ team }: { team: TeamData }) {
  const users = team.members;
  const router = useRouter();
  const [email, setEmail] = React.useState("");
  const [invite, setInvite] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [armed, setArmed] = React.useState<string | null>(null);

  async function add(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const added = await addMember({ data: { email: email.trim(), invite } });
      toast.success(invite ? `${added.email} can sign in, invite sent` : `${added.email} can sign in`);
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
      await removeMember({ data: { email: address } });
      toast.success(`${address} can no longer sign in`);
      await router.invalidate();
    } catch (error) {
      toast.error(errorText(error, "Could not remove this person"));
    }
  }

  const you = team.you;
  const valid = /^\S+@\S+\.\S+$/.test(email.trim());

  return (
    <>
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
          <Empty title="Nobody yet">Add the first member above.</Empty>
        ) : (
          <Table head={["Email", "Role", ""]}>
            {users.map((user) => (
              <tr key={user.email} data-testid="team-user">
                <td className="px-3 py-2.5">
                  {user.email}
                  {user.email === you ? <span className="ml-2 text-xs text-muted-foreground">(you)</span> : null}
                  {user.owner ? <span className="ml-2 text-xs text-muted-foreground">owner</span> : null}
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
