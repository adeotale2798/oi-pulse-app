import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { useParams } from "react-router-dom";
import PublicLegalPage from "@/pages/PublicLegalPage";
import { api } from "@/lib/api";

jest.mock("@/lib/api", () => ({
  api: { get: jest.fn() },
}));

jest.mock("react-router-dom", () => {
  const ReactModule = require("react");
  return {
    Link: ({ to, children, ...props }) => ReactModule.createElement("a", { href: to, ...props }, children),
    useParams: jest.fn(),
  };
});

describe("public trust and legal pages", () => {
  let container;
  let root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    api.get.mockResolvedValue({ data: { is_admin: false } });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  });

  it("explains current privacy and retention behavior without claiming self-service deletion", () => {
    useParams.mockReturnValue({ document: "privacy" });

    act(() => root.render(<PublicLegalPage />));

    expect(container.querySelector("h1").textContent).toBe("Privacy notice");
    expect(container.textContent).toContain("Version V21.04");
    expect(container.textContent).toContain("broker app API key, API secret, and daily access token encrypted");
    expect(container.textContent).toContain("no member self-service account deletion, journal deletion, or data export control");
    expect(container.textContent).not.toContain("Publication readiness: operator details and legal review are still required.");
    expect(container.textContent).not.toContain("Publication readiness: operator details and legal review are still required.");
    expect(container.textContent).toContain("IP address, browser user-agent, request timestamps, and error metadata");
    expect(container.querySelector('a[href="/legal/privacy"]').getAttribute("aria-current")).toBe("page");
  });

  it("shows publication readiness only after the server confirms an Admin session", async () => {
    useParams.mockReturnValue({ document: "privacy" });
    api.get.mockResolvedValueOnce({ data: { is_admin: true } });

    await act(async () => {
      root.render(<PublicLegalPage />);
      await Promise.resolve();
    });

    expect(container.querySelector('[data-testid="publication-readiness-note"]')).not.toBeNull();
    expect(container.textContent).toContain("Publication readiness: operator details and legal review are still required.");
  });

  it("shows clear billing and market-risk terms", () => {
    useParams.mockReturnValue({ document: "subscriptions" });

    act(() => root.render(<PublicLegalPage />));

    expect(container.querySelector("h1").textContent).toBe("Subscriptions and refunds");
    expect(container.textContent).toContain("does not currently offer an in-app refund-request workflow");
    expect(container.textContent).toContain("app access to Basic immediately");
  });

  it("discloses that an Admin-only CAS workflow can submit broker orders", () => {
    useParams.mockReturnValue({ document: "terms" });

    act(() => root.render(<PublicLegalPage />));

    expect(container.textContent).toContain("Some Admin-only CAS workflows can submit orders");
    expect(container.textContent).toContain("Guests and paid members do not receive ranked sell candidates");
    expect(container.textContent).toContain("The operator's legal identity, address, governing-law selection");
  });

  it("explains that automated orders can fail or remain open", () => {
    useParams.mockReturnValue({ document: "risk" });

    act(() => root.render(<PublicLegalPage />));

    expect(container.textContent).toContain("may submit orders to the configured broker account");
    expect(container.textContent).toContain("that it will close an open position");
    expect(container.textContent).toContain("No statement on this site establishes that the operator is registered, licensed, authorized, or exempt");
  });

  it("handles unknown legal document slugs with a home link", () => {
    useParams.mockReturnValue({ document: "missing" });

    act(() => root.render(<PublicLegalPage />));

    expect(container.textContent).toContain("Page not found");
    expect(container.querySelector('a[href="/"]')).not.toBeNull();
  });
});
