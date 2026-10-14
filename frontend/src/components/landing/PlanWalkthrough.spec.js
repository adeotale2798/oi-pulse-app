import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { api } from "@/lib/api";
import PlanWalkthrough, { PLAN_FEATURE_DETAILS } from "./PlanWalkthrough";

jest.mock("@/lib/api", () => ({
  api: { get: jest.fn() },
}));

describe("PlanWalkthrough", () => {
  let container;
  let root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    api.get.mockReset();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  });

  it("has a user-edge description and preview for every known member feature", () => {
    Object.values(PLAN_FEATURE_DETAILS).forEach((detail) => {
      expect(detail.description).toBeTruthy();
      expect(detail.edge).toBeTruthy();
      expect(detail.preview).toBeTruthy();
    });
    expect(Object.keys(PLAN_FEATURE_DETAILS)).not.toEqual(expect.arrayContaining([
      "sell_candidates",
      "position_insights",
      "writer_defense",
      "suggestion_window",
      "chart_signal_chips",
    ]));
    expect(PLAN_FEATURE_DETAILS.positions.title).toBe("Your open positions");
  });

  it("does not render recommendation features left in stale membership settings", async () => {
    api.get.mockResolvedValue({ data: { features: [], copy: {}, snapshot: null } });
    await act(async () => {
      root.render(<PlanWalkthrough planId="pro" features={[
        { id: "sell_candidates", label: "Sell Candidates" },
        { id: "position_insights", label: "Position insights" },
      ]} />);
    });
    expect(container.textContent).toContain("No feature walkthrough is currently configured");
    expect(container.textContent).not.toContain("Sell Candidates");
    expect(container.textContent).not.toContain("Position insights");
  });

  it("shows fictional member positions without displaying position advice", async () => {
    api.get.mockResolvedValue({
      data: { features: ["positions"], copy: {}, snapshot: null },
    });
    await act(async () => {
      root.render(<PlanWalkthrough planId="pro" features={[{ id: "positions", label: "Your open positions" }]} />);
    });
    expect(container.textContent).toContain("Your open positions");
    expect(container.textContent).toContain("FICTIONAL");
    expect(container.textContent).toContain("does not provide position guidance");
    expect(container.textContent).not.toMatch(/\b(hedge|roll|buy|sell|exit)\b/i);
  });

  it("shows Desk AI as a consolidated market briefing without exposing private member data", async () => {
    api.get.mockResolvedValue({
      data: {
        features: ["desk_ai"],
        copy: {
          desk_ai: {
            description: "Ask about your positions and get a trader's answer.",
            edge: "Receive personalized trade directions.",
          },
        },
        snapshot: {
          captured_at: "2026-10-15T08:00:00Z",
          desk_market: {
            status: "captured",
            data: {
              quote_source: "Kite",
              updated_at: "2026-10-15T08:00:00Z",
              movers: [{
                index: "NIFTY",
                symbol: "HDFCBANK",
                pct: 0.54,
                weightage: 12.4,
                buyer: "hidden buyer idea",
                seller: "hidden seller idea",
              }],
              breadth: { NIFTY: { n: 50, adv: 31, dec: 19 } },
            },
          },
          market_intel: { status: "captured", data: { items: [{ title: "Shared headline" }] } },
          global_markets: { status: "captured", data: { items: [{ symbol: "Nikkei" }] } },
          indices: { NIFTY: { events: { status: "captured", data: { events: [{ title: "Results" }] } } } },
        },
      },
    });

    await act(async () => {
      root.render(<PlanWalkthrough planId="pro" features={[{ id: "desk_ai", label: "Desk AI" }]} />);
    });

    expect(container.textContent).toContain("consolidated market briefing");
    expect(container.textContent).toContain("Market today");
    expect(container.textContent).toContain("31 advancing");
    expect(container.textContent).toContain("HDFCBANK");
    expect(container.textContent).toContain("12.40%");
    expect(container.textContent).toContain("0.54%");
    expect(container.textContent).toContain("1 captured stories");
    expect(container.textContent).toContain("1 captured instruments");
    expect(container.textContent).toContain("Market Intel, Global Markets, Indian index breadth, heavyweight moves and event context");
    expect(container.textContent).not.toContain("does not access, analyze or comment on your broker positions");
    expect(container.textContent).not.toContain("get a trader's answer");
    expect(container.textContent).not.toContain("personalized trade directions");
    expect(container.textContent).not.toContain("hidden buyer idea");
    expect(container.textContent).not.toContain("hidden seller idea");
    expect(container.textContent).not.toMatch(/\b(hedge|roll|buy|sell|exit)\b/i);
    expect(container.querySelector("input")).toBeNull();
  });

  it("renders captured OI values instead of invented market-chart values", async () => {
    api.get.mockResolvedValue({
      data: {
        features: ["oi_change"],
        copy: {},
        snapshot: {
          captured_at: "2026-10-15T08:00:00Z",
          indices: {
            NIFTY: {
              oi_change: {
                status: "captured",
                data_status: { label: "LIVE" },
                current: {
                  index: "NIFTY",
                  timestamp: "2026-10-15T08:00:00Z",
                  price: 22500,
                  atm: 22500,
                  strikes: [
                    { strike: 22450, ce_oi: 100000, pe_oi: 160000 },
                    { strike: 22500, ce_oi: 120000, pe_oi: 180000 },
                  ],
                },
                previous: {
                  strikes: [
                    { strike: 22450, ce_oi: 90000, pe_oi: 150000 },
                    { strike: 22500, ce_oi: 110000, pe_oi: 170000 },
                  ],
                },
              },
            },
          },
        },
      },
    });

    await act(async () => {
      root.render(<PlanWalkthrough planId="normal" features={[{ id: "oi_change", label: "OI Change" }]} />);
    });

    expect(api.get).toHaveBeenCalledWith("/public/landing-plan-preview/normal");
    expect(container.textContent).toContain("Saved capture + labeled samples");
    expect(container.textContent).toContain("Shared publisher OI · LIVE");
    expect(container.textContent).toContain("22,500");
    expect(container.querySelector('[data-testid="landing-oi-chart"]')).not.toBeNull();
    expect(container.textContent).toContain("OI Change");
    expect(container.querySelector('[data-testid="landing-oi-chart"]').textContent).toContain("2 strikes");
    expect(container.textContent).not.toContain("Fictional sample levels");
  });

  it("gives each core OI feature a distinct, neutral sample view", async () => {
    const features = [
      { id: "oi_change", label: "OI Change" },
      { id: "open_interest", label: "Open Interest" },
      { id: "strike_table", label: "Strike Table" },
      { id: "buildup", label: "Build-up" },
      { id: "straddle", label: "Straddle" },
    ];
    api.get.mockResolvedValue({
      data: { features: features.map(({ id }) => id), copy: {}, snapshot: null },
    });
    await act(async () => {
      root.render(<PlanWalkthrough planId="normal" features={features} />);
    });

    expect(container.textContent).toContain("OI Change");
    expect(container.textContent).toContain("Illustrative sample");
    expect(container.querySelector('[data-testid="landing-oi-chart"]')).not.toBeNull();
    const openInterestTab = Array.from(container.querySelectorAll("nav button"))
      .find((button) => button.textContent === "Open Interest");
    await act(async () => openInterestTab.click());
    expect(container.textContent).toContain("Open Interest");
    const openInterestChart = container.querySelector('[data-testid="landing-oi-chart"]');
    expect(openInterestChart).not.toBeNull();
    expect(openInterestChart.textContent).toContain("current OI distribution");
    expect(openInterestChart.textContent).toContain("Distribution");
    expect(openInterestChart.textContent).not.toContain("window change");
    expect(openInterestChart.textContent).not.toContain("Increase");

    const oiChangeTab = Array.from(container.querySelectorAll("nav button"))
      .find((button) => button.textContent === "OI Change");
    await act(async () => oiChangeTab.click());
    const oiChangeChart = container.querySelector('[data-testid="landing-oi-chart"]');
    expect(oiChangeChart.textContent).toContain("OI with window change");
    expect(oiChangeChart.textContent).toContain("Increase");

    const strikeTableTab = Array.from(container.querySelectorAll("nav button"))
      .find((button) => button.textContent === "Strike Table");
    await act(async () => strikeTableTab.click());
    expect(container.textContent).toContain("Call ΔOI");
    expect(container.querySelector('[data-testid="landing-oi-chart"]')).toBeNull();

    const buildupTab = Array.from(container.querySelectorAll("nav button"))
      .find((button) => button.textContent === "Build-up");
    await act(async () => buildupTab.click());
    expect(container.querySelector('[data-testid="buildup-preview"]')).not.toBeNull();
    expect(container.textContent).toContain("Call ΔPrice");
    expect(container.textContent).not.toMatch(/\b(Bullish|Bearish|Bias|Long Build-up|Short Build-up)\b/i);

    const straddleTab = Array.from(container.querySelectorAll("nav button"))
      .find((button) => button.textContent === "Straddle");
    await act(async () => straddleTab.click());
    expect(container.textContent).toContain("Illustrative ATM straddle premium");
    expect(container.querySelector('[data-testid="landing-oi-chart"]')).toBeNull();
  });

  it("uses the Admin's current captured snapshot in its local preview without a public fetch", async () => {
    await act(async () => {
      root.render(
        <PlanWalkthrough
          planId="normal"
          features={[{ id: "oi_change", label: "OI Change" }]}
          previewSettings={{
            features: ["oi_change"],
            copy: {},
            snapshot: {
              captured_at: "2026-10-14T08:00:00Z",
              indices: {
                NIFTY: {
                  oi_change: {
                    status: "captured",
                    data_status: { label: "LIVE", window_minutes: 15 },
                    current: {
                      index: "NIFTY",
                      timestamp: "2026-10-14T08:00:00Z",
                      price: 25810,
                      atm: 25800,
                      strikes: [
                        { strike: 25800, ce_oi: 120000, pe_oi: 180000 },
                      ],
                    },
                    previous: {
                      strikes: [
                        { strike: 25800, ce_oi: 100000, pe_oi: 150000 },
                      ],
                    },
                  },
                },
              },
            },
          }}
        />,
      );
    });

    expect(api.get).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Shared publisher OI · LIVE");
    expect(container.textContent).toContain("25,810");
    expect(container.textContent).not.toContain("Illustrative strike profile");
  });

  it("fills empty market tabs with clearly labeled sample previews", async () => {
    api.get.mockResolvedValue({
      data: {
        features: ["open_interest", "activity", "market_intel", "global_markets", "events", "index_risk", "straddle"],
        copy: {},
        snapshot: null,
      },
    });

    await act(async () => {
      root.render(<PlanWalkthrough planId="normal" features={[
        { id: "open_interest", label: "Open Interest" },
        { id: "activity", label: "Activity" },
        { id: "market_intel", label: "Market Intel" },
        { id: "global_markets", label: "Global Markets" },
        { id: "events", label: "Events & trading holidays" },
        { id: "index_risk", label: "Index Risk" },
        { id: "straddle", label: "Straddle" },
      ]} />);
    });

    expect(container.textContent).toContain("Labeled sample previews");
    expect(container.textContent).toContain("Illustrative sample · not live");
    expect(container.textContent).toContain("25,850");

    for (const [label, expected, marker] of [
      ["Activity", "Illustrative OI shift alert", "Illustrative sample · not live"],
      ["Market Intel", "Global rate expectations: sample headline", "Illustrative sample · not live"],
      ["Global Markets", "GIFT NIFTY", "Illustrative sample · not live"],
      ["Events & trading holidays", "Built-in NSE holiday calendar", "Actual app calendar dates"],
      ["Straddle", "Illustrative ATM straddle premium", "Illustrative sample · not live"],
    ]) {
      const tab = Array.from(container.querySelectorAll("nav button")).find((button) => button.textContent.includes(label));
      await act(async () => tab.click());
      expect(container.textContent).toContain(expected);
      expect(container.textContent).toContain(marker);
    }

    const indexRiskTab = Array.from(container.querySelectorAll("nav button"))
      .find((button) => button.textContent.includes("Index Risk"));
    await act(async () => indexRiskTab.click());
    const riskSummary = container.querySelector('[data-testid="index-risk-summary"]');
    expect(riskSummary).not.toBeNull();
    expect(riskSummary.textContent).toContain("Listed events");
    expect(container.querySelectorAll('[data-testid="index-risk-event"]')).toHaveLength(3);
    expect(container.textContent).toContain("Earnings watch");
    expect(container.textContent).toContain("Quarterly results");
  });

  it("fills unavailable Desk AI facts with labeled samples and never reads member positions", async () => {
    api.get.mockResolvedValue({
      data: { features: ["desk_ai"], copy: {}, snapshot: null },
    });
    await act(async () => {
      root.render(<PlanWalkthrough planId="pro" features={[{ id: "desk_ai", label: "Desk AI" }]} />);
    });
    expect(container.textContent).toContain("SAMPLECO");
    expect(container.textContent).toContain("Illustrative sample · not live");
    expect(container.textContent).toContain("Indian index movers, breadth and event context");
    expect(container.textContent).not.toContain("does not access, analyze or comment on your broker positions");
    expect(container.textContent).not.toMatch(/\b(hedge|roll|buy|sell|exit)\b/i);
  });

  it("shows a distinct, relevant fictional factor breakdown for Pro overnight risk", async () => {
    api.get.mockResolvedValue({
      data: { features: ["overnight_position_risk"], copy: {}, snapshot: null },
    });
    await act(async () => {
      root.render(<PlanWalkthrough planId="pro" features={[{ id: "overnight_position_risk", label: "Overnight risk-factor summary" }]} />);
    });

    expect(container.querySelector('[data-testid="overnight-risk-preview"]')).not.toBeNull();
    expect(container.textContent).toContain("India VIX");
    expect(container.textContent).toContain("Book delta");
    expect(container.textContent).toContain("Time to expiry");
    expect(container.textContent).toContain("Scheduled events");
    expect(container.textContent).toContain("FICTIONAL EXAMPLE");
    expect(container.textContent).not.toContain("Your open positions");
  });

  it("lets visitors inspect captured holidays and index events", async () => {
    api.get.mockResolvedValue({
      data: {
        features: ["events", "index_risk"],
        copy: {},
        snapshot: {
          captured_at: "2026-10-15T08:00:00Z",
          holidays: {
            status: "captured",
            data: { holidays: [{ date: "2026-12-25", name: "Captured holiday", session: null }] },
          },
          indices: {
            NIFTY: {
              events: {
                status: "captured",
                data: {
                  events: [{
                    event_date: "2026-10-20",
                    event_type: "Quarterly Results",
                    symbol: "TESTCO",
                    company_name: "Test Company",
                    days_remaining: 5,
                    weightage: 1.25,
                  }],
                },
              },
            },
          },
        },
      },
    });

    await act(async () => {
      root.render(<PlanWalkthrough planId="normal" features={[{ id: "events", label: "Events" }, { id: "index_risk", label: "Index Risk" }]} />);
    });
    expect(container.textContent).toContain("Captured holiday");

    const marketEvents = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent.includes("Index events"));
    await act(async () => marketEvents.click());
    expect(container.textContent).toContain("Test Company");
    expect(container.textContent).toContain("Quarterly Results");

    const riskTab = Array.from(container.querySelectorAll("nav button"))
      .find((button) => button.textContent.includes("Index Risk"));
    await act(async () => riskTab.click());
    expect(container.querySelector('[data-testid="index-risk-summary"]')).not.toBeNull();
    expect(container.textContent).toContain("NIFTY · upcoming event context");
    expect(container.textContent).toContain("Test Company");
    expect(container.textContent).toContain("not a risk score or trade instruction");
  });

  it("keeps Admin's captured Desk AI walkthrough readable without replacing it with public samples", async () => {
    const previewSettings = {
      features: ["desk_ai"],
      copy: {},
      snapshot: {
        captured_at: "2026-10-15T08:00:00Z",
        desk_market: {
          status: "captured",
          data: {
            quote_source: "Admin capture",
            updated_at: "2026-10-15T08:00:00Z",
            movers: [{ index: "NIFTY", symbol: "CAPTUREDCO", pct: 0.42, weightage: 6.2 }],
            breadth: { NIFTY: { n: 50, adv: 29, dec: 21 } },
          },
        },
        market_intel: { status: "captured", data: { items: [{ title: "Captured story" }] } },
        global_markets: { status: "captured", data: { items: [{ symbol: "Captured index" }] } },
        indices: { NIFTY: { events: { status: "captured", data: { events: [{ title: "Captured event" }] } } } },
      },
    };

    await act(async () => {
      root.render(
        <PlanWalkthrough
          planId="pro"
          features={[{ id: "desk_ai", label: "Desk AI" }]}
          previewSettings={previewSettings}
        />,
      );
    });

    expect(api.get).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Admin-captured · static");
    expect(container.textContent).toContain("CAPTUREDCO");
    expect(container.textContent).toContain("6.20%");
    expect(container.textContent).toContain("1 captured stories");
    expect(container.textContent).toContain("1 captured instruments");
    expect(container.textContent).not.toContain("SAMPLECO");
    expect(container.textContent).not.toMatch(/\b(hedge|roll|buy|sell|exit)\b/i);
  });

  it("gives each personal-alert feature controls and sample content matching its name", async () => {
    const alertFeatures = [
      { id: "alerts", label: "Personal Alerts inbox" },
      { id: "alert_sounds", label: "Alert sound preferences" },
      { id: "oi_shift_alerts", label: "OI Shift alerts" },
      { id: "oi_change_alerts", label: "OI Change alerts" },
      { id: "event_alerts", label: "Event alerts" },
    ];
    api.get.mockResolvedValue({
      data: { features: alertFeatures.map(({ id }) => id), copy: {}, snapshot: null },
    });
    await act(async () => {
      root.render(<PlanWalkthrough planId="premium" features={alertFeatures} />);
    });

    expect(container.textContent).toContain("Review an alert in your private inbox");
    expect(container.textContent).toContain("Market Intel");
    expect(container.textContent).toContain("Global market shift");
    expect(container.textContent).toContain("Major constituent move");
    expect(container.textContent).toContain("Sample OI change");
    expect(container.textContent).toContain("6 illustrative updates");
    expect(container.textContent).toContain("sample only");
    const acknowledge = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent === "Acknowledge");
    await act(async () => acknowledge.click());
    expect(container.textContent).toContain("Acknowledged");
    const alertFilter = container.querySelector('[aria-label="Alert inbox index"]');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(alertFilter, "BANKNIFTY");
      alertFilter.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(container.textContent).toContain("Major constituent move");
    expect(container.textContent).toContain("Sample strike OI shift");
    expect(container.textContent).not.toContain("Market Intel · policy context");
    expect(container.textContent).not.toContain("Global market shift");

    for (const [tabLabel, title, controlLabel, changedValue, expected] of [
      ["Alert sound preferences", "Choose whether eligible alerts play a sound", "Play alert sounds", false, "no sound will play"],
      ["OI Shift alerts", "Set a threshold for rapid strike shifts", "Minimum contracts", 250_000, "does not cross"],
      ["OI Change alerts", "Set the minimum OI-change threshold", "Minimum OI change", 30, "does not cross"],
      ["Event alerts", "Choose how far ahead to surface a calendar reminder", "Reminder lead time", "7", "7 days before the event"],
    ]) {
      const tab = Array.from(container.querySelectorAll("nav button"))
        .find((button) => button.textContent.includes(tabLabel));
      await act(async () => tab.click());
      expect(container.textContent).toContain(title);
      const control = container.querySelector(`[aria-label="${controlLabel}"]`);
      await act(async () => {
        if (control.type === "checkbox") {
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "checked").set.call(control, changedValue);
          control.dispatchEvent(new Event("change", { bubbles: true }));
        } else {
          const prototype = control.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
          Object.getOwnPropertyDescriptor(prototype, "value").set.call(control, String(changedValue));
          control.dispatchEvent(new Event("input", { bubbles: true }));
          control.dispatchEvent(new Event("change", { bubbles: true }));
        }
      });
      expect(container.textContent).toContain(expected);
    }
  });
});
