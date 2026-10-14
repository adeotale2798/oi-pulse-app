import React, { act } from "react";
import { createRoot } from "react-dom/client";
import Login from "@/pages/Login";
import { api } from "@/lib/api";

jest.mock("react-router-dom", () => {
  const ReactModule = require("react");
  return {
    Link: ({ to, children, ...props }) => ReactModule.createElement("a", { href: to, ...props }, children),
    useNavigate: () => jest.fn(),
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
  persistGuestAuth: jest.fn(),
}));
jest.mock("@/hooks/useLiveDemo", () => ({
  __esModule: true,
  default: () => ({ indices: { SENSEX: { price: 84000, changePct: 0.2 } } }),
  isMarketOpenNow: () => false,
}));
jest.mock("@/components/landing/BrowserMock", () => () => null);

describe("Login guest sign-in control", () => {
  let container;
  let root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    api.get.mockReset();
    api.post.mockReset();
    window.history.replaceState({}, "", "/login");
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  });

  async function renderWithAuthState(guestLoginEnabled, googleLoginEnabled = true) {
    api.get.mockResolvedValue({
      data: {
        google_login_enabled: googleLoginEnabled,
        guest_login_enabled: guestLoginEnabled,
      },
    });
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
});
