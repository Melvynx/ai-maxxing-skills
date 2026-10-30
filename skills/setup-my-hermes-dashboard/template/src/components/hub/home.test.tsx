import { render, screen } from "@testing-library/react";

import { HubHome } from "./home";

// The cards link with the router; a plain link is enough to read them here.
vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children, ...props }: { to: string; children: React.ReactNode }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}));

describe("home", () => {
  it("starts with no module and says how to ask Hermes for one", () => {
    render(<HubHome items={[]} summary={{ owner: "Ada", hermesUrl: null, status: null, model: null, admin: false, infra: null }} />);
    expect(screen.getByTestId("home-empty")).toHaveTextContent("No module yet");
    expect(screen.getByTestId("home-empty")).toHaveTextContent("~/projects/dashboard");
    expect(screen.getByTestId("home-ops")).toHaveTextContent("Unreachable");
    expect(screen.queryByText("Hermes agent")).toBeNull();
    expect(screen.queryByTestId("home-infra")).toBeNull();
  });

  it("links to Hermes and shows its state when it runs", () => {
    render(
      <HubHome
        items={[]}
        summary={{
          owner: "Ada",
          hermesUrl: "https://hermes.example.com",
          model: "claude-opus-5-5",
          admin: true,
          infra: { at: Date.now(), tone: "bad", bad: 2, warn: 1 },
          status: { version: "0.9.0", overall: "ok", gatewayRunning: true, platforms: ["telegram"], activeSessions: 1, disk: { usedPercent: 40, freeMb: 51_200, totalMb: 98_304 } },
        }}
      />,
    );
    expect(screen.getByTestId("home-ops")).toHaveTextContent("Running");
    expect(screen.getByTestId("home-ops")).toHaveTextContent("Telegram");
    expect(screen.getByRole("link", { name: "Hermes agent" })).toHaveAttribute("href", "https://hermes.example.com");
    expect(screen.getByTestId("home-infra")).toHaveTextContent("Needs you");
    expect(screen.getByTestId("home-infra")).toHaveTextContent("2 problems");
    expect(screen.getByRole("link", { name: "Infra" })).toHaveAttribute("href", "/infra");
  });
});
