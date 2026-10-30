import React, { act } from "react";
import { createRoot } from "react-dom/client";
import AccountSettings from "@/pages/AccountSettings";
import { api, memberBrokerCredentialsStatus } from "@/lib/api";
import { toast } from "sonner";

jest.mock("react-router-dom", () => {
  const ReactModule = require("react");
  return {
    Link: ({ to, children, ...props }) => ReactModule.createElement("a", { href: to, ...props }, children),
    useSearchParams: () => [ReactModule.useMemo(() => new URLSearchParams(), [])],
  };
});

jest.mock("sonner", () => ({ toast: { error: jest.fn(), success: jest.fn() } }));
jest.mock("@/lib/api", () => ({
  api: { get: jest.fn(), post: jest.fn(), put: jest.fn() },
  deleteUserKiteCredentials: jest.fn(),
  logoutGuest: jest.fn(),
  memberBrokerCredentialsStatus: jest.fn(),
}));

describe("AccountSettings immediate paid cancellation", () => {
  let container;
  let root;
  let originalConfirm;
  let profileReads;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    originalConfirm = window.confirm;
    window.confirm = jest.fn(() => true);
    profileReads = 0;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    api.get.mockReset();
    api.post.mockReset();
    api.put.mockReset();
    toast.error.mockReset();
    toast.success.mockReset();
    memberBrokerCredentialsStatus.mockReset();
    memberBrokerCredentialsStatus.mockResolvedValue({});
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    window.confirm = originalConfirm;
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  });

  it("confirms immediate cancellation and refreshes the member onto Basic", async () => {
    api.get.mockImplementation((path) => {
      if (path === "/membership/me") {
        profileReads += 1;
        return Promise.resolve({ data: profileReads === 1
          ? {
            plan: "pro",
            member: { email: "member@example.test" },
            subscription: { id: "sub-1", plan: "pro", status: "active" },
            subscription_history: [{
              event_type: "subscription_status_changed",
              details: { plan: "pro", status: "past_due" },
              created_at: "2026-10-15T12:00:00Z",
            }],
            preferences: {},
          }
          : {
            plan: "normal",
            member: { email: "member@example.test" },
            subscription: { id: "sub-1", plan: "pro", status: "cancelled" },
            subscription_history: [{
              event_type: "subscription_renewal_cancelled",
              details: { access_ends_immediately: true },
              created_at: "2026-10-15T12:00:00Z",
            }],
            preferences: {},
          } });
      }
      if (path === "/public/site-config") {
        return Promise.resolve({ data: {
          membership: { paid_subscriptions_enabled: true },
          features: { razorpay_enabled: true },
          pricing: { premium: {}, pro: {} },
        } });
      }
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });
    api.post.mockResolvedValue({ data: { ok: true, plan: "normal" } });

    await act(async () => {
      root.render(<AccountSettings />);
      await Promise.resolve();
    });

    const cancelButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent.includes("Cancel subscription"));
    expect(cancelButton).not.toBeUndefined();
    const reasonSelect = container.querySelector("#subscription-cancel-reason");
    await act(async () => {
      reasonSelect.value = "price";
      reasonSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => {
      cancelButton.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("Paid access will end immediately"));
    expect(container.textContent).toContain("Subscription history");
    expect(container.textContent).toContain("Subscription cancelled · paid access ended immediately and Basic resumed");
    expect(container.querySelector('a[href="#subscription-options"]')?.textContent).toContain("Subscribe again");
    expect(api.post).toHaveBeenCalledWith("/billing/cancel", { reason: "price" });
    expect(container.textContent).toContain("Basic access");
    expect(toast.success).toHaveBeenCalledWith("Subscription cancelled. Your account is now on Basic.");
  });

  it("shows loading and handles account API failures", async () => {
    let rejectProfile;
    api.get.mockImplementation((path) => {
      if (path === "/membership/me") {
        return new Promise((_resolve, reject) => { rejectProfile = reject; });
      }
      if (path === "/public/site-config") return Promise.resolve({ data: {} });
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });

    await act(async () => {
      root.render(<AccountSettings />);
    });
    expect(container.textContent).toContain("Loading account");

    await act(async () => {
      rejectProfile({ response: { data: { detail: "Account service unavailable" } } });
      await Promise.resolve();
    });
    expect(toast.error).toHaveBeenCalledWith("Account service unavailable");
    expect(container.textContent).not.toContain("Loading account");
  });

  it("shows an empty subscription history for a new Basic member", async () => {
    api.get.mockImplementation((path) => {
      if (path === "/membership/me") {
        return Promise.resolve({ data: {
          plan: "normal",
          member: { email: "new-member@example.test" },
          subscription: {},
          subscription_history: [],
          preferences: {},
        } });
      }
      if (path === "/public/site-config") {
        return Promise.resolve({ data: {
          membership: { paid_subscriptions_enabled: false },
          features: { razorpay_enabled: false },
        } });
      }
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });

    await act(async () => {
      root.render(<AccountSettings />);
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Billing changes will appear here after your first checkout.");
    expect(container.querySelector('a[href="#subscription-options"]')).not.toBeNull();
  });
});
