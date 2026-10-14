import React, { act } from "react";
import { createRoot } from "react-dom/client";
import AdminLandingPage from "@/pages/AdminLandingPage";
import { api } from "@/lib/api";

jest.mock("react-router-dom", () => {
  const ReactModule = require("react");
  const navigate = jest.fn();
  return {
    Link: ({ to, children, ...props }) => ReactModule.createElement("a", { href: to, ...props }, children),
    useNavigate: () => navigate,
  };
});

jest.mock("@/lib/api", () => ({
  api: { get: jest.fn(), post: jest.fn() },
}));

jest.mock("sonner", () => ({ toast: { error: jest.fn(), success: jest.fn() } }));
jest.mock("@/components/ui/dialog", () => {
  const ReactModule = require("react");
  return {
    Dialog: ({ open, children }) => open ? ReactModule.createElement("div", null, children) : null,
    DialogContent: ({ children }) => ReactModule.createElement("div", null, children),
    DialogDescription: ({ children }) => ReactModule.createElement("p", null, children),
    DialogTitle: ({ children }) => ReactModule.createElement("h2", null, children),
  };
});

describe("Admin landing page controls", () => {
  let container;
  let root;
  const config = {
    landing_page: { plan_more_info_enabled: true },
    membership: { plans: { normal: { features: [] }, premium: { features: [] }, pro: { features: [] } } },
    brokers: [],
  };

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    api.get.mockResolvedValue({ data: config });
    api.post.mockResolvedValue({});
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  });

  it("persists the More info setting without changing membership settings", async () => {
    await act(async () => {
      root.render(<AdminLandingPage />);
    });
    const toggle = container.querySelector('[role="switch"][aria-label="Show plan More info buttons"]');
    expect(toggle.getAttribute("aria-checked")).toBe("true");

    await act(async () => toggle.click());
    expect(toggle.getAttribute("aria-checked")).toBe("false");

    await act(async () => {
      Array.from(container.querySelectorAll("button")).find((button) => button.textContent.includes("Save")).click();
    });

    expect(api.post).toHaveBeenCalledWith("/admin/platform/config", expect.objectContaining({
      landing_page: expect.objectContaining({ plan_more_info_enabled: false }),
    }));
  });

  it("offers Straddle and Market & Global Events while removing OI Distribution", async () => {
    await act(async () => {
      root.render(<AdminLandingPage />);
    });

    expect(container.textContent).toContain("Straddle");
    expect(container.textContent).toContain("Market & Global Events");
    expect(container.textContent).not.toContain("OI Distribution");
  });
});
