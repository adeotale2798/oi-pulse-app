import React, { act } from "react";
import { createRoot } from "react-dom/client";
import AdminMembershipAnalytics from "@/pages/AdminMembershipAnalytics";
import { api } from "@/lib/api";
import { toast } from "sonner";

jest.mock("react-router-dom", () => {
  const ReactModule = require("react");
  return {
    Link: ({ to, children, ...props }) => ReactModule.createElement("a", { href: to, ...props }, children),
  };
});

jest.mock("sonner", () => ({ toast: { error: jest.fn() } }));
jest.mock("@/lib/api", () => ({
  api: { get: jest.fn() },
}));

const analytics = {
  date_range: { from: "2026-10-24", to: "2026-10-30" },
  funnel: {
    signups: 3,
    checkout_started: 2,
    paid: 1,
    signup_to_checkout_rate: 66.7,
    signup_to_paid_rate: 33.3,
  },
  current: {
    members_by_plan: { normal: 12, premium: 4, pro: 2 },
    active_paid_subscriptions: 6,
    estimated_mrr: 5000,
    estimated_mrr_by_plan: { premium: 2000, pro: 3000 },
    currency: "INR",
  },
  revenue: {
    currency: "INR",
    gross_collected_minor: 125000,
    refunded_minor: 5000,
    net_collected_minor: 120000,
    amount_records: 1,
    historical_data_incomplete: true,
    note: "Older payment records may not include amounts.",
    reconciliation_note: "Compare this worksheet with provider settlements.",
    excluded_other_currency_records: 0,
  },
  performance: {
    elapsed_ms: 100,
    total_documents_read: 20,
  },
  charge_note: "No renewal count is inferred.",
  cancellation_reasons: [{ reason: "price", count: 2 }],
  daily: [{ date: "2026-10-30", signups: 3, checkouts: 2 }],
  acquisition: [{ source: "google", signups: 1 }],
  paid_cohorts: [{
    month: "2026-10",
    paid_members: 1,
    active_now: 1,
    not_active_now: 0,
    not_active_rate: 0,
    retention_rate: 100,
  }],
  paid_cohort_note: "Not active now is observed cohort attrition, not a period churn rate.",
  monthly_reconciliation: [{
    month: "2026-10",
    coverage_from: "2026-10-24",
    coverage_to: "2026-10-30",
    successful_charges: 1,
    charges_with_amounts: 1,
    gross_collected_minor: 125000,
    refund_increases: 1,
    refunded_minor: 5000,
    net_collected_minor: 120000,
  }],
  recent_signups_total: 1,
  recent_signups_truncated: 0,
  recent_signups: [{
    id: "member-1",
    name: "New Member",
    email: "new@example.test",
    created_at: "2026-10-30T09:00:00+00:00",
    plan: "premium",
    subscription_status: "active",
    acquisition: { utm_source: "google" },
  }],
};

describe("Admin membership analytics", () => {
  let container;
  let root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    api.get.mockReset();
    toast.error.mockReset();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  });

  it("loads the default seven-day dashboard and links signups to member management", async () => {
    api.get.mockResolvedValue({ data: analytics });

    await act(async () => {
      root.render(<AdminMembershipAnalytics />);
      await Promise.resolve();
    });

    expect(api.get).toHaveBeenCalledWith("/admin/membership-analytics", { params: { days: 7 } });
    expect(container.textContent).toContain("Membership analytics");
    expect(container.textContent).toContain("New signups");
    expect(container.textContent).toContain("Paid-cohort retention");
    expect(container.textContent).toContain("New Member");
    expect(container.textContent).toContain("66.7%");
    expect(container.textContent).toContain("33.3%");
    expect(container.textContent).toContain("Revenue data coverage");
    expect(container.textContent).toContain("Monthly collection reconciliation");
    expect(container.textContent).toContain("observed cohort attrition, not a period churn rate");
    expect(container.textContent).toContain("Member-provided cancellation reasons");
    expect(container.textContent).toContain("Price");
    expect(container.querySelector('button[aria-label="Export monthly reconciliation CSV"]')).not.toBeNull();
    expect(container.querySelector('a[href="/admin/subscriptions?member_id=member-1"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="analytics-mobile-reconciliation"]').textContent).toContain("2026-10");
    expect(container.querySelector('[data-testid="analytics-mobile-cohorts"]').textContent).toContain("Paid members");
    expect(container.querySelector('[data-testid="analytics-mobile-signups"]').textContent).toContain("new@example.test");
  });

  it("reports analytics API errors and keeps a retry action", async () => {
    api.get.mockRejectedValue({ response: { data: { detail: "Admin only" } } });

    await act(async () => {
      root.render(<AdminMembershipAnalytics />);
      await Promise.resolve();
    });

    expect(container.querySelector('[role="alert"]').textContent).toContain("Admin only");
    expect(toast.error).toHaveBeenCalledWith("Admin only");
  });

  it("downloads a monthly reconciliation CSV for the selected range", async () => {
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    URL.createObjectURL = jest.fn(() => "blob:membership-reconciliation");
    URL.revokeObjectURL = jest.fn();
    const clickAnchor = jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function click() {
      expect(this.download).toBe("membership-reconciliation-2026-10-24-2026-10-30.csv");
    });
    api.get.mockResolvedValue({ data: analytics });

    try {
      await act(async () => {
        root.render(<AdminMembershipAnalytics />);
        await Promise.resolve();
      });

      await act(async () => {
        container.querySelector('[aria-label="Export monthly reconciliation CSV"]').click();
        await new Promise((resolve) => window.setTimeout(resolve, 1));
      });

      expect(URL.createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
      expect(clickAnchor).toHaveBeenCalledTimes(1);
    } finally {
      clickAnchor.mockRestore();
      if (originalCreateObjectURL) URL.createObjectURL = originalCreateObjectURL;
      else delete URL.createObjectURL;
      if (originalRevokeObjectURL) URL.revokeObjectURL = originalRevokeObjectURL;
      else delete URL.revokeObjectURL;
    }
  });

  it("applies a custom date range to the admin analytics request", async () => {
    api.get.mockResolvedValue({ data: analytics });

    await act(async () => {
      root.render(<AdminMembershipAnalytics />);
      await Promise.resolve();
    });

    const selector = container.querySelector("#membership-period");
    await act(async () => {
      selector.value = "custom";
      selector.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const form = container.querySelector('form[aria-label="Analytics date range"]')
      || container.querySelector("form");
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });

    expect(api.get).toHaveBeenLastCalledWith("/admin/membership-analytics", {
      params: { from: "2026-10-24", to: "2026-10-30" },
    });
  });
});
