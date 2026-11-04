import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { HubFrame } from "./sidebar";

// The rail links with the router; a plain link is enough to read it here.
vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children, ...props }: { to: string; children: React.ReactNode }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
  useRouterState: () => "/",
}));

const frame = (viewer: { email: string | null; role: "admin" | "member" }, collapsed = false) =>
  render(
    <HubFrame initialCollapsed={collapsed} initialMonitoringOpen hermesUrl={null} viewer={viewer}>
      <p>page</p>
    </HubFrame>,
  );

/** Opens the account menu at the bottom of the rail and returns its entries. */
async function accountMenu() {
  await userEvent.setup().click(within(screen.getByTestId("hub-sidebar")).getByTestId("hub-account"));
  return within(await screen.findByTestId("hub-account-menu"));
}

describe("sidebar", () => {
  it("gives admins API keys and Team in the account menu", async () => {
    frame({ email: "ada@example.com", role: "admin" });
    const rail = within(screen.getByTestId("hub-sidebar"));
    expect(rail.getByTestId("hub-monitoring")).toBeInTheDocument();
    expect(rail.getByTestId("hub-account")).toHaveTextContent("ada@example.com");
    expect(rail.getByTestId("hub-account")).toHaveTextContent("Admin");
    const menu = await accountMenu();
    expect(menu.getByTestId("hub-account-email")).toHaveTextContent("ada@example.com");
    expect(menu.getByRole("menuitem", { name: "API keys" })).toHaveAttribute("href", "/api-keys");
    expect(menu.getByRole("menuitem", { name: "Team" })).toHaveAttribute("href", "/team");
    expect(menu.getByRole("menuitem", { name: "Dark theme" })).toBeInTheDocument();
    expect(menu.getByRole("menuitem", { name: "Sign out" })).toHaveAttribute("href", "/.gate/logout");
  });

  it("gives members neither monitoring, API keys nor Team", async () => {
    frame({ email: "bob@example.com", role: "member" });
    expect(within(screen.getByTestId("hub-sidebar")).queryByTestId("hub-monitoring")).toBeNull();
    const menu = await accountMenu();
    expect(menu.queryByRole("menuitem", { name: "API keys" })).toBeNull();
    expect(menu.queryByRole("menuitem", { name: "Team" })).toBeNull();
    expect(menu.getByRole("menuitem", { name: "Sign out" })).toBeInTheDocument();
  });

  it("names an admin signed in by saved IP (no email)", () => {
    frame({ email: null, role: "admin" });
    expect(within(screen.getByTestId("hub-sidebar")).getByTestId("hub-account")).toHaveTextContent("IP access");
  });

  it("keeps every name on the icon-only rail", () => {
    frame({ email: "ada@example.com", role: "admin" }, true);
    const rail = within(screen.getByTestId("hub-sidebar"));
    expect(rail.getByRole("link", { name: "Home" })).toHaveAttribute("href", "/");
    expect(rail.getByRole("button", { name: "Expand the sidebar" })).toBe(rail.getByTestId("hub-collapse"));
    expect(rail.getByRole("button", { name: /ada@example\.com/ })).toBe(rail.getByTestId("hub-account"));
  });
});
