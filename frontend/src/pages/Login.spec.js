import React, { act } from "react";
import { createRoot } from "react-dom/client";
import Login from "@/pages/Login";
import { api, fetchTickers, persistGuestAuth } from "@/lib/api";

jest.mock("react-router-dom", () => {
  const ReactModule = require("react");
  return {
    Link: ({ to, children, ...props }) => ReactModule.createElement("a", { href: to, ...props }, children),
    useNavigate: () => (path) => { globalThis.__lastLoginNavigation = path; },
  };
});

jest.mock("framer-motion", () => {
  const ReactModule = require("react");
  const motion = new Proxy({}, {
    get: (_target, tag) => ReactModule.forwardRef(({
      initial, animate, transition, whileInView, viewport, exit, ...props
    }, ref) => ReactModule.createElement(tag, { ...props, ref })),
  });
  return { motion };
});

jest.mock("sonner", () => ({ toast: { error: jest.fn(), success: jest.fn(), message: jest.fn() } }));
jest.mock("@/lib/api", () => ({
  api: { get: jest.fn(), post: jest.fn() },
  fetchTickers: jest.fn(),
  persistGuestAuth: jest.fn(),
}));
jest.mock("@/components/landing/BrowserMock", () => {
  const ReactModule = require("react");
  return ({ snap, marketData, status, chipAlign }) => ReactModule.createElement("div", {
    "data-testid": "login-market-preview",
    "data-status": status,
    "data-chip-align": chipAlign,
    "data-sensex-price": snap?.indices?.SENSEX?.price ?? "",
    "data-oi-timestamp": marketData?.oi?.current?.timestamp ?? "",
  });
});

describe("Login guest sign-in control", () => {
  let container;
  let root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    window.sessionStorage.clear();
    window.localStorage.clear();
    delete globalThis.__lastLoginNavigation;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    api.get.mockReset();
    api.post.mockReset();
    fetchTickers.mockReset();
    persistGuestAuth.mockReset();
    fetchTickers.mockResolvedValue({ mode: "offline", tickers: [] });
    window.history.replaceState({}, "", "/login");
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  });

  async function renderWithAuthState(
    guestLoginEnabled,
    googleLoginEnabled = true,
    marketStatus = { is_market_open: false },
    loginOiPreview = {
      current: { timestamp: "2026-10-28T09:30:00+05:30", strikes: [{ strike: 25000, ce_oi: 100, pe_oi: 120 }] },
      data_status: { is_live: true },
    },
  ) {
    api.get.mockImplementation((path) => Promise.resolve({
      data: path === "/market/status"
        ? marketStatus
        : path === "/public/login-preview/oi"
          ? loginOiPreview
          : {
            google_login_enabled: googleLoginEnabled,
            guest_login_enabled: guestLoginEnabled,
          },
    }));
    await act(async () => {
      root.render(<Login />);
      await Promise.resolve();
    });
  }

  it("shows Google sign-in only when guest sign-in is disabled", async () => {
    await renderWithAuthState(false);

    expect(container.textContent).toContain("Continue with Google");
    expect(container.textContent).not.toContain("guest access");
    expect(container.querySelector("#guest-name")).toBeNull();
  });

  it("shows the guest form only when the server enables guest sign-in", async () => {
    await renderWithAuthState(true);

    expect(container.textContent).toContain("Continue with Google");
    expect(container.textContent).toContain("or guest access");
    expect(container.querySelector("#guest-name")).not.toBeNull();
  });

  it("keeps guest entry available when Google is disabled but guest sign-in is enabled", async () => {
    await renderWithAuthState(true, false);

    expect(container.textContent).toContain("Enter your full name to access the guest market desk.");
    expect(container.querySelector("#guest-name")).not.toBeNull();
    expect(container.textContent).not.toContain("Continue with Google");
  });

  it("uses the branded welcome heading and omits broker-password reassurance", async () => {
    await renderWithAuthState(false);

    expect(container.textContent).toContain("Welcome to StrikLenz");
    expect(container.textContent).not.toContain("broker password");
    expect(container.textContent).toContain("Information only, not investment advice.");
  });

  it("centers the login product preview within its dark panel", async () => {
    await renderWithAuthState(false);

    const hero = container.querySelector("h2").parentElement;
    expect(hero.className).toContain("self-center");
    expect(hero.className).toContain("text-center");
    expect(hero.querySelector("p").className).toContain("mx-auto");
    expect(hero.querySelector(".mt-8").className).toContain("mx-auto");
    const brand = container.querySelector(".lg\\:flex a");
    const headline = container.querySelector(".lg\\:flex h2");
    expect(brand.className).toContain("justify-center");
    expect(brand.compareDocumentPosition(headline) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("keeps the sign-in card scrollable and centers its brand on narrow screens", async () => {
    await renderWithAuthState(false);

    const page = container.firstElementChild;
    const card = container.querySelector("h1").closest(".max-w-md");
    expect(page.className).toContain("overflow-x-hidden");
    expect(page.className).not.toContain("overflow-hidden");
    expect(card.parentElement.className).toContain("items-center");
    expect(card.querySelector(".relative.mb-7").className).toContain("justify-center");
    expect(card.querySelector("button").textContent).toContain("Continue with Google");
  });

  it("uses current shared-feed quotes and OI snapshot in the login preview", async () => {
    fetchTickers.mockResolvedValue({
      mode: "live",
      tickers: ["NIFTY", "BANKNIFTY", "SENSEX"].map((index) => ({
        index,
        ltp: index === "SENSEX" ? 84000 : 25000,
        change_pct: 0.2,
        is_live: true,
      })),
    });
    await renderWithAuthState(false, true, { is_market_open: true, is_oi_polling: true });

    const preview = container.querySelector('[data-testid="login-market-preview"]');
    expect(fetchTickers).toHaveBeenCalled();
    expect(api.get).toHaveBeenCalledWith("/public/login-preview/oi");
    expect(preview.dataset.status).toBe("live");
    expect(preview.dataset.sensexPrice).toBe("84000");
    expect(preview.dataset.oiTimestamp).toBe("2026-10-28T09:30:00+05:30");
    expect(preview.dataset.chipAlign).toBe("left");
  });

  it("does not substitute illustrative prices when the public feeds are unavailable", async () => {
    await renderWithAuthState(false, true, { is_market_open: false }, null);

    const preview = container.querySelector('[data-testid="login-market-preview"]');
    expect(preview.dataset.status).toBe("unavailable");
    expect(preview.dataset.sensexPrice).toBe("");
  });

  it("persists the returned Google member session and opens the dashboard", async () => {
    window.sessionStorage.setItem("oi_google_oauth_state", "expected-state");
    window.history.replaceState({}, "", "/login?code=google-code&state=expected-state");
    api.get.mockImplementation((path) => Promise.resolve({
      data: path === "/market/status"
        ? { is_market_open: false }
        : path === "/public/login-preview/oi"
          ? null
          : { google_login_enabled: true, guest_login_enabled: false },
    }));
    api.post.mockResolvedValue({
      data: {
        token: "member-session-token",
        name: "Returning Member",
        email: "member@example.test",
        expires_in_seconds: 30 * 24 * 60 * 60,
        expires_at: "2026-11-27T00:00:00+00:00",
      },
    });

    await act(async () => {
      root.render(<Login />);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(api.post).toHaveBeenCalledWith("/auth/google/exchange", expect.objectContaining({
      code: "google-code",
      redirect_uri: expect.stringMatching(/\/login$/),
    }));
    expect(persistGuestAuth).toHaveBeenCalledWith({
      token: "member-session-token",
      name: "Returning Member",
      expiresInSeconds: 30 * 24 * 60 * 60,
      expiresAt: "2026-11-27T00:00:00+00:00",
    });
    expect(globalThis.__lastLoginNavigation).toBe("/dashboard");
  });
});
