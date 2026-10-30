import React, { act } from "react";
import { createRoot } from "react-dom/client";
import AdminSubscriptions from "@/pages/AdminSubscriptions";
import { api } from "@/lib/api";
import { toast } from "sonner";

jest.mock("react-router-dom", () => {
  const ReactModule = require("react");
  return {
    Link: ({ to, children, ...props }) => ReactModule.createElement("a", { href: to, ...props }, children),
  };
});

jest.mock("sonner", () => ({ toast: { error: jest.fn(), success: jest.fn() } }));
jest.mock("@/lib/api", () => ({
  api: { get: jest.fn(), patch: jest.fn() },
}));

describe("Admin subscription health", () => {
  let container;
  let root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    window.history.replaceState({}, "", "/");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    api.get.mockReset();
    api.patch.mockReset();
    toast.error.mockReset();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    window.history.replaceState({}, "", "/");
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  });

  it("shows current plan access and all-time billing totals", async () => {
    api.get.mockImplementation((path) => {
      if (path === "/admin/members") return Promise.resolve({ data: { members: [] } });
      if (path === "/admin/subscription-health") {
        return Promise.resolve({ data: {
          active_members_by_plan: { normal: 12, premium: 4, pro: 2 },
          all_time: { charge_events: 30, cancellations: 8, failed_payments: 3 },
          blocked_basic_members: 5,
          blocked_basic_member_list: [{
            id: "blocked-1",
            name: "Blocked member",
            email: "blocked@example.test",
            payment_status: null,
          }],
          blocked_basic_members_truncated: 4,
          payment_attention_members: [{
            id: "failed-1",
            name: "Failed member",
            email: "failed@example.test",
            plan: "normal",
            payment_status: "past_due",
          }],
          payment_attention_members_count: 1,
          basic_plan_enabled: false,
        } });
      }
      if (path === "/admin/members?member_id=blocked-1") {
        return Promise.resolve({ data: { members: [{
          id: "blocked-1",
          email: "blocked@example.test",
          plan: "normal",
          disabled: false,
        }] } });
      }
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });

    await act(async () => {
      root.render(<AdminSubscriptions />);
      await Promise.resolve();
    });

    expect(api.get).toHaveBeenCalledWith("/admin/subscription-health");
    expect(container.querySelector('[data-testid="health-active-normal"]').textContent).toContain("12");
    expect(container.querySelector('[data-testid="health-active-premium"]').textContent).toContain("4");
    expect(container.querySelector('[data-testid="health-active-pro"]').textContent).toContain("2");
    expect(container.querySelector('[data-testid="health-charge-events"]').textContent).toContain("30");
    expect(container.querySelector('[data-testid="health-cancellations"]').textContent).toContain("8");
    expect(container.querySelector('[data-testid="health-failed-payments"]').textContent).toContain("3");
    expect(container.querySelector('[data-testid="health-basic-members-blocked"]').textContent).toContain("5");
    expect(container.textContent).toContain("Basic access is disabled");
    expect(container.textContent).toContain("Blocked member");
    expect(container.textContent).toContain("Payments needing attention");
    expect(container.textContent).toContain("failed@example.test");

    const manageButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent === "Manage");
    await act(async () => {
      manageButton.click();
      await Promise.resolve();
    });
    expect(api.get).toHaveBeenCalledWith("/admin/members?member_id=blocked-1");
    expect(container.textContent).toContain("Showing the selected member only.");
    expect(container.querySelector("#member-blocked-1")).not.toBeNull();
  });

  it("keeps member management available and surfaces health errors", async () => {
    api.get.mockImplementation((path) => {
      if (path === "/admin/members") return Promise.resolve({ data: { members: [] } });
      return Promise.reject({ response: { data: { detail: "Health service unavailable" } } });
    });

    await act(async () => {
      root.render(<AdminSubscriptions />);
      await Promise.resolve();
    });

    expect(container.querySelector('[role="alert"]').textContent).toContain("Health service unavailable");
    expect(container.textContent).toContain("No member accounts yet.");
    expect(toast.error).toHaveBeenCalledWith("Health service unavailable");
  });

  it("opens a member-management link filtered to the selected signup", async () => {
    window.history.replaceState({}, "", "/admin/subscriptions?member_id=member-1");
    api.get.mockImplementation((path) => {
      if (path === "/admin/members?member_id=member-1") {
        return Promise.resolve({ data: { members: [{
          id: "member-1",
          email: "new@example.test",
          plan: "premium",
          subscription: { status: "active" },
        }] } });
      }
      if (path === "/admin/subscription-health") {
        return Promise.resolve({ data: {
          active_members_by_plan: { normal: 0, premium: 1, pro: 0 },
          all_time: { charge_events: 0, cancellations: 0, failed_payments: 0 },
          blocked_basic_members: 0,
          blocked_basic_member_list: [],
          payment_attention_members: [],
          payment_attention_members_count: 0,
          basic_plan_enabled: true,
        } });
      }
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });

    await act(async () => {
      root.render(<AdminSubscriptions />);
      await Promise.resolve();
    });

    expect(api.get).toHaveBeenCalledWith("/admin/members?member_id=member-1");
    expect(container.textContent).toContain("Showing the selected member only.");
    expect(container.querySelector("#member-member-1")).not.toBeNull();
    window.history.replaceState({}, "", "/");
  });

  it("shows a structured cancellation reason in the Admin audit", async () => {
    api.get.mockImplementation((path) => {
      if (path === "/admin/members") return Promise.resolve({ data: { members: [{
        id: "member-1",
        email: "member@example.test",
        plan: "normal",
      }] } });
      if (path === "/admin/subscription-health") return Promise.resolve({ data: {
        active_members_by_plan: { normal: 1, premium: 0, pro: 0 },
        all_time: { charge_events: 0, cancellations: 1, failed_payments: 0 },
        blocked_basic_members: 0,
        blocked_basic_member_list: [],
        payment_attention_members: [],
        payment_attention_members_count: 0,
        basic_plan_enabled: true,
      } });
      if (path === "/admin/members/member-1/audit") return Promise.resolve({ data: { events: [{
        event_type: "subscription_renewal_cancelled",
        actor: "member",
        created_at: "2026-10-30T09:00:00Z",
        details: { reason: "price" },
      }] } });
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });

    await act(async () => {
      root.render(<AdminSubscriptions />);
      await Promise.resolve();
    });
    const auditButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent.includes("View audit history"));
    await act(async () => {
      auditButton.click();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Reason: Price");
  });

  it("shows actionable empty states when no members need attention", async () => {
    api.get.mockImplementation((path) => {
      if (path === "/admin/members") return Promise.resolve({ data: { members: [] } });
      if (path === "/admin/subscription-health") return Promise.resolve({ data: {
        active_members_by_plan: { normal: 0, premium: 0, pro: 0 },
        all_time: { charge_events: 0, cancellations: 0, failed_payments: 0 },
        blocked_basic_members: 0,
        blocked_basic_member_list: [],
        payment_attention_members: [],
        payment_attention_members_count: 0,
        basic_plan_enabled: false,
      } });
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });

    await act(async () => {
      root.render(<AdminSubscriptions />);
      await Promise.resolve();
    });

    expect(container.textContent).toContain("No blocked Basic members.");
    expect(container.textContent).toContain("No payment issues currently need attention.");
    expect(container.textContent).toContain("No member accounts yet.");
  });
});
