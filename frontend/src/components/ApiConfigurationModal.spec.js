import React, { act } from "react";
import { createRoot } from "react-dom/client";
import ApiConfigurationModal from "./ApiConfigurationModal";
import { api } from "@/lib/api";

jest.mock("@/lib/api", () => ({
  api: { get: jest.fn() },
}));

jest.mock("@/components/ui/dialog", () => {
  const React = require("react");
  const element = (tag) => ({ children, ...props }) => React.createElement(tag, props, children);
  return {
    Dialog: ({ open, children }) => open ? React.createElement("div", null, children) : null,
    DialogContent: element("div"),
    DialogHeader: element("header"),
    DialogTitle: element("h2"),
    DialogDescription: element("p"),
  };
});

jest.mock("@/components/AdminDialogNavigation", () => () => null);
jest.mock("@/components/ui/button", () => {
  const React = require("react");
  return { Button: ({ variant, size, ...props }) => React.createElement("button", props) };
});

describe("ApiConfigurationModal", () => {
  let container;
  let root;

  beforeEach(() => {
    api.get.mockReset().mockResolvedValue({
      data: {
        providers: [],
        summary: {
          providers: 0,
          endpoints: 0,
          modules: 0,
          active: 0,
          healthy: 0,
          warning: 0,
          errors_today: 0,
          avg_latency_ms: null,
        },
      },
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    global.IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("switches between the existing API view and the technology stack tiles", async () => {
    await act(async () => {
      root.render(<ApiConfigurationModal open onOpenChange={jest.fn()} />);
      await Promise.resolve();
    });

    const apiTile = container.querySelector('[data-testid="tile-api-configuration"]');
    const stackTile = container.querySelector('[data-testid="tile-tech-stack"]');
    expect(container.textContent).toContain("API Config & Stack");
    expect(apiTile.getAttribute("aria-pressed")).toBe("true");

    await act(async () => stackTile.click());
    expect(container.querySelector('[data-testid="tech-stack-content"]')).not.toBeNull();
    expect(container.textContent).toContain("React 19");
    expect(container.textContent).toContain("FastAPI");
    expect(container.textContent).toContain("MongoDB 6+");
    expect(container.textContent).toContain("The pages, dashboards, forms, charts and controls that run in the browser.");
    expect(container.textContent).toContain("Receives app requests, applies access rules, runs backend services and returns data to the web app.");
    expect(container.textContent).toContain("StrikLenz at a glance");
    expect(container.textContent).toContain("Your browser");
    expect(container.textContent).toContain("App database");
    expect(container.textContent).toContain("Versions shown are the app’s declared major versions and runtime minimums.");
    expect(stackTile.getAttribute("aria-pressed")).toBe("true");

    await act(async () => apiTile.click());
    expect(container.textContent).toContain("Tracked providers are discovered from source.");
    expect(apiTile.getAttribute("aria-pressed")).toBe("true");
    expect(api.get).toHaveBeenCalledTimes(1);
  });
});
