import React, { act } from "react";
import { createRoot } from "react-dom/client";
import AdminSettings from "@/pages/AdminSettings";
import { api } from "@/lib/api";
import { toast } from "sonner";

jest.mock("react-router-dom", () => {
  const ReactModule = require("react");
  const navigate = jest.fn();
  return {
    Link: ({ to, children, ...props }) => ReactModule.createElement("a", { href: to, ...props }, children),
    useNavigate: () => navigate,
  };
});

jest.mock("sonner", () => ({ toast: { error: jest.fn(), success: jest.fn() } }));
jest.mock("@/lib/api", () => ({ api: { get: jest.fn(), post: jest.fn() } }));

describe("Admin guest sign-in setting", () => {
  let container;
  let root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    api.get.mockReset();
    api.post.mockReset();
    toast.error.mockReset();
    toast.success.mockReset();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  });

  it("loads the switch under Google Sign-In and saves its setting", async () => {
    const config = {
      guest_login_enabled: false,
      public_entry_auth_timeout_seconds: 15,
      google: { enabled: true, client_id: "client", client_secret: "set", redirect_uri: "https://example.test/login" },
      brokers: [],
    };
    api.get.mockResolvedValue({ data: config });
    api.post.mockResolvedValue({ data: {} });

    await act(async () => {
      root.render(<AdminSettings />);
      await Promise.resolve();
    });

    expect(api.get).toHaveBeenCalledWith("/admin/platform/config", { timeout: 10000 });
    const guestToggle = container.querySelector('[aria-label="Allow guest sign-in"]');
    expect(guestToggle).not.toBeNull();
    expect(guestToggle.getAttribute("aria-pressed")).toBe("false");

    const timeoutInput = container.querySelector('[aria-label="Public entry connection wait"]');
    expect(timeoutInput.value).toBe("15");
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(timeoutInput, "25");
      timeoutInput.dispatchEvent(new Event("input", { bubbles: true }));
    });

    await act(async () => guestToggle.click());
    expect(guestToggle.getAttribute("aria-pressed")).toBe("true");

    await act(async () => {
      Array.from(container.querySelectorAll("button")).find((button) => button.textContent.includes("Save")).click();
      await Promise.resolve();
    });

    expect(api.post).toHaveBeenCalledWith("/admin/platform/config", expect.objectContaining({
      guest_login_enabled: true,
      public_entry_auth_timeout_seconds: 25,
    }));
  });

  it("saves site walkthrough availability immediately using the shared dashboard setting", async () => {
    api.get.mockResolvedValue({ data: { sitewalkthrough_enabled: false, brokers: [] } });
    api.post.mockResolvedValue({ data: { sitewalkthrough_enabled: true } });

    await act(async () => {
      root.render(<AdminSettings />);
      await Promise.resolve();
    });

    const walkthroughToggle = container.querySelector('[aria-label="Enable site walkthrough"]');
    expect(walkthroughToggle.getAttribute("aria-pressed")).toBe("false");
    await act(async () => {
      walkthroughToggle.click();
      await Promise.resolve();
    });

    expect(api.post).toHaveBeenCalledWith("/settings", { sitewalkthrough_enabled: true });
    expect(walkthroughToggle.getAttribute("aria-pressed")).toBe("true");
    expect(toast.success).toHaveBeenCalledWith("Site walkthrough enabled");
  });

  it("restores the prior walkthrough setting and reports a save failure", async () => {
    api.get.mockResolvedValue({ data: { sitewalkthrough_enabled: false, brokers: [] } });
    api.post.mockRejectedValue({ response: { data: { detail: "Walkthrough save failed" } } });

    await act(async () => {
      root.render(<AdminSettings />);
      await Promise.resolve();
    });

    const walkthroughToggle = container.querySelector('[aria-label="Enable site walkthrough"]');
    await act(async () => {
      walkthroughToggle.click();
      await Promise.resolve();
    });

    expect(api.post).toHaveBeenCalledWith("/settings", { sitewalkthrough_enabled: true });
    expect(walkthroughToggle.getAttribute("aria-pressed")).toBe("false");
    expect(toast.error).toHaveBeenCalledWith("Walkthrough save failed");
  });

  it("blocks saving a public entry wait outside the allowed range", async () => {
    api.get.mockResolvedValue({ data: { public_entry_auth_timeout_seconds: 10 } });

    await act(async () => {
      root.render(<AdminSettings />);
      await Promise.resolve();
    });

    const timeoutInput = container.querySelector('[aria-label="Public entry connection wait"]');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(timeoutInput, "4");
      timeoutInput.dispatchEvent(new Event("input", { bubbles: true }));
    });

    await act(async () => {
      Array.from(container.querySelectorAll("button")).find((button) => button.textContent.includes("Save")).click();
    });

    expect(api.post).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("Public entry wait must be 5–60 seconds");
  });

  it("keeps first-period offer guidance above all three cadence fields", async () => {
    api.get.mockResolvedValue({ data: { brokers: [] } });

    await act(async () => {
      root.render(<AdminSettings />);
      await Promise.resolve();
    });

    for (const plan of ["premium", "pro"]) {
      const offerGrid = container.querySelector(`[data-testid="razorpay-offer-grid-${plan}"]`);
      expect(offerGrid).not.toBeNull();
      expect(offerGrid.querySelectorAll("label")).toHaveLength(3);
      expect(container.querySelector(`[data-testid="razorpay-offer-help-${plan}"]`).textContent)
        .toContain("matching offer ID for each billing cadence");
      expect(container.querySelector(`[data-testid="offer-price-grid-${plan}"]`).querySelectorAll("input"))
        .toHaveLength(3);
    }
  });

  it("saves a cadence-specific first-period price for the matching Razorpay offer", async () => {
    api.get.mockResolvedValue({ data: { brokers: [] } });
    api.post.mockResolvedValue({ data: {} });

    await act(async () => {
      root.render(<AdminSettings />);
      await Promise.resolve();
    });

    const priceInput = container.querySelector('[aria-label="premium monthly first-period offer price"]');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(priceInput, "799");
      priceInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      Array.from(container.querySelectorAll("button")).find((button) => button.textContent.includes("Save")).click();
      await Promise.resolve();
    });

    expect(api.post).toHaveBeenCalledWith("/admin/platform/config", expect.objectContaining({
      pricing: expect.objectContaining({
        premium: expect.objectContaining({
          offer_prices: expect.objectContaining({ monthly: "799" }),
        }),
      }),
    }));
  });

  it("shows a clear load error and retries the configuration request", async () => {
    api.get
      .mockRejectedValueOnce({ code: "ECONNABORTED" })
      .mockResolvedValueOnce({ data: { brokers: [] } });

    await act(async () => {
      root.render(<AdminSettings />);
      await Promise.resolve();
    });

    expect(container.querySelector('[data-testid="admin-settings-load-error"]').textContent)
      .toContain("took too long to load");
    const retry = container.querySelector('[data-testid="admin-settings-retry"]');
    expect(retry).not.toBeNull();
    expect(container.querySelector('a[href="/dashboard"]').textContent).toContain("Return to dashboard");

    await act(async () => {
      retry.click();
      await Promise.resolve();
    });

    expect(api.get).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[data-testid="admin-settings-load-error"]')).toBeNull();
    expect(container.textContent).toContain("Admin Settings");
  });
});
