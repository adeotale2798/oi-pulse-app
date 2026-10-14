import React, { act } from "react";
import { createRoot } from "react-dom/client";
import AuthGate from "@/components/AuthGate";
import { api } from "@/lib/api";

jest.mock("react-router-dom", () => {
  const ReactModule = require("react");
  return {
    Link: ({ to, children, ...props }) => ReactModule.createElement("a", { href: to, ...props }, children),
    Navigate: ({ to }) => ReactModule.createElement("div", { "data-testid": "navigate", "data-to": to }),
    useLocation: () => ({ pathname: "/dashboard" }),
  };
});

jest.mock("@/hooks/useQuiescentAwarePolling", () => {
  const ReactModule = require("react");
  const useMockPolling = (callback) => ReactModule.useEffect(() => { callback(); }, []);
  return {
    __esModule: true,
    default: useMockPolling,
  };
});

jest.mock("@/lib/authBoot", () => ({
  isTransientHttpError: () => false,
  storedDeskSession: () => null,
  optimisticDeskAuthState: () => null,
  withTimeout: (promise) => promise,
}));

jest.mock("@/lib/api", () => ({
  api: { get: jest.fn(), post: jest.fn() },
  clearGuestAuth: jest.fn(),
  clearAdminAuth: jest.fn(),
  persistGuestAuth: jest.fn(),
  persistAdminSession: jest.fn(),
}));

jest.mock("@/pages/Dashboard", () => () => null);

describe("AuthGate disabled-plan access", () => {
  let container;
  let root;
  let originalPath;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    originalPath = window.location.pathname;
    window.history.replaceState({}, "", "/dashboard");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    api.get.mockReset();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    window.history.replaceState({}, "", originalPath);
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  });

  it("shows a polite subscription prompt when Basic access is disabled", async () => {
    api.get.mockResolvedValue({ data: {
      is_member: true,
      membership: {
        plan: "normal",
        enabled: false,
        available_paid_plans: ["premium", "pro"],
      },
    } });

    await act(async () => {
      root.render(<AuthGate><div data-testid="member-dashboard">Desk</div></AuthGate>);
      await Promise.resolve();
    });

    expect(container.querySelector("[data-testid='member-dashboard']")).toBeNull();
    expect(container.textContent).toContain("The Basic plan is currently unavailable");
    expect(container.querySelector('a[href="/account?plan=premium"]')).not.toBeNull();
    expect(container.querySelector('a[href="/account?plan=pro"]')).not.toBeNull();
    expect(container.querySelector('a[href="/account"]')).not.toBeNull();
  });

  it("keeps dashboard access available when Basic is enabled", async () => {
    api.get.mockResolvedValue({ data: {
      is_member: true,
      membership: { plan: "normal", enabled: true, features: ["oi_change"] },
    } });

    await act(async () => {
      root.render(<AuthGate><div data-testid="member-dashboard">Desk</div></AuthGate>);
      await Promise.resolve();
    });

    expect(container.querySelector("[data-testid='member-dashboard']")).not.toBeNull();
    expect(container.textContent).not.toContain("subscription");
  });
});
