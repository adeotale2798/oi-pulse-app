import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { api } from "@/lib/api";
import EventRiskWidget from "./EventRiskWidget";

jest.mock("@/lib/api", () => ({
  api: { get: jest.fn() },
}));

const bandEvents = [
  { id: "high", symbol: "HIGH", company_name: "High Weight Ltd", event_type: "Quarterly Results", event_date: "2026-10-20", days_remaining: 3, weightage: 8 },
  { id: "upper-mid", symbol: "UPPER", company_name: "Upper Band Ltd", event_type: "Dividend", event_date: "2026-10-21", days_remaining: 4, weightage: 5 },
  { id: "mid", symbol: "MID", company_name: "Middle Band Ltd", event_type: "Board Meeting", event_date: "2026-10-22", days_remaining: 5, weightage: 2.5 },
  { id: "low", symbol: "LOW", company_name: "Low Band Ltd", event_type: "AGM", event_date: "2026-10-23", days_remaining: 6, weightage: 0.98 },
  { id: "unknown", symbol: "UNKNOWN", company_name: "Unknown Weight Ltd", event_type: "Other", event_date: "2026-10-24", days_remaining: 7, weightage: null },
];

describe("EventRiskWidget weight colors", () => {
  let container;
  let root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.removeItem("oi_event_risk_dismissed");
    api.get.mockResolvedValue({ data: { events: bandEvents } });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  });

  it("renders each constituent-weight band consistently on chips and cards", async () => {
    await act(async () => {
      root.render(<EventRiskWidget activeIndex="NIFTY" />);
    });

    const expected = [
      ["HIGH", "border-l-4 border-l-rose-600", "High index share"],
      ["UPPER", "border-l-orange-400", "3–5% weight"],
      ["MID", "border-l-amber-400", "1–3% weight"],
      ["LOW", "border-l-yellow-400", "<1% weight"],
      ["UNKNOWN", "border-l-slate-300", "Weight unavailable"],
    ];

    for (const [symbol, accent, label] of expected) {
      const chip = container.querySelector(`[data-testid="event-chip-${symbol}"]`);
      const card = container.querySelector(`[data-testid="event-card-${symbol}"]`);
      expect(chip).not.toBeNull();
      expect(card).not.toBeNull();
      expect(chip.className).toContain(accent);
      expect(card.className).toContain(accent);
      expect(card.textContent).toContain(label);
    }

    expect(container.querySelector('[data-testid="event-card-UPPER"]').className).toContain("bg-orange-50");
    expect(container.querySelector('[data-testid="event-card-MID"]').className).toContain("bg-amber-50");
    expect(container.querySelector('[data-testid="event-card-LOW"]').className).toContain("bg-yellow-50");
    expect(container.querySelector('[data-testid="event-card-UNKNOWN"]').className).toContain("bg-slate-50");
  });

  it("uses the high-weight urgent accent only for events within seven days", async () => {
    const events = [
      ...bandEvents,
      { ...bandEvents[0], id: "far-high", symbol: "FARHIGH", days_remaining: 8 },
    ];
    api.get.mockResolvedValue({ data: { events } });
    await act(async () => {
      root.render(<EventRiskWidget activeIndex="NIFTY" />);
    });

    expect(container.querySelector('[data-testid="event-card-HIGH"]').className).toContain("border-l-4");
    expect(container.querySelector('[data-testid="event-chip-HIGH"]').className).toContain("bg-rose-100");
    expect(container.querySelector('[data-testid="event-card-FARHIGH"]').className).toContain("border-l-rose-400");
    expect(container.querySelector('[data-testid="event-card-FARHIGH"]').className).not.toContain("border-l-4");
  });

  it("shows source-backed news risk only when Market Intel is available", async () => {
    api.get.mockImplementation((url) => {
      if (url === "/events/NIFTY") return Promise.resolve({ data: { events: bandEvents } });
      return Promise.resolve({
        data: {
          indices: [{
            index: "NIFTY",
            status: "READY",
            risk_level: "HIGH",
            direction: "NEGATIVE",
            evidence_confidence: "MEDIUM",
            event_count: 1,
            events: [{
              event_cluster_id: "hdfc-results",
              title: "HDFC Bank results miss estimates",
              weightage: 12.5,
              reason: "Constituent news with high index exposure.",
            }],
            result_calendar_status: "CURRENT",
            scheduled_results: [{
              symbol: "HDFCBANK",
              company_name: "HDFC Bank Limited",
              weightage: 25,
              news_status: "RESULTS_NEWS_FOUND",
              stories: [{
                title: "HDFC Bank quarterly results beat estimates",
                article_url: "https://example.test/hdfc-results",
              }],
            }],
          }],
        },
      });
    });

    await act(async () => {
      root.render(<EventRiskWidget activeIndex="NIFTY" marketIntelEnabled />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.querySelector('[data-testid="event-risk-news"]')?.textContent)
      .toContain("HDFC Bank results miss estimates");
    expect(container.querySelector('[data-testid="event-risk-news"]')?.textContent)
      .toContain("NIFTY");
    expect(container.querySelector('[data-testid="event-risk-news"]')?.textContent)
      .toContain("12.50% index share");
    expect(container.querySelector('[data-testid="event-risk-news-details"]')?.open).toBe(false);
    expect(container.querySelector('[data-testid="event-risk-scheduled-results"]')?.textContent)
      .toContain("Results news found");
  });
});
