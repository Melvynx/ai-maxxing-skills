import { render, screen } from "@testing-library/react";

import { HubHome } from "./home";

describe("home", () => {
  it("starts with no module and says how to ask Hermes for one", () => {
    render(<HubHome items={[]} summary={{ owner: "Ada", hermesUrl: null, status: null, model: null }} />);
    expect(screen.getByTestId("home-empty")).toHaveTextContent("No module yet");
    expect(screen.getByTestId("home-empty")).toHaveTextContent("~/projects/dashboard");
    expect(screen.getByTestId("home-ops")).toHaveTextContent("Unreachable");
    expect(screen.queryByText("Hermes agent")).toBeNull();
  });

  it("links to Hermes and shows its state when it runs", () => {
    render(
      <HubHome
        items={[]}
        summary={{
          owner: "Ada",
          hermesUrl: "https://hermes.example.com",
          model: "claude-opus-5-5",
          status: { version: "0.9.0", overall: "ok", gatewayRunning: true, platforms: ["telegram"], activeSessions: 1, disk: { usedPercent: 40, freeMb: 51_200, totalMb: 98_304 } },
        }}
      />,
    );
    expect(screen.getByTestId("home-ops")).toHaveTextContent("Running");
    expect(screen.getByTestId("home-ops")).toHaveTextContent("Telegram");
    expect(screen.getByRole("link", { name: "Hermes agent" })).toHaveAttribute("href", "https://hermes.example.com");
  });
});
