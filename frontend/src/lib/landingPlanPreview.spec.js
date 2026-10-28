import { api, fetchOIChange } from "@/lib/api";
import { captureLandingPlanSnapshot } from "./landingPlanPreview";

jest.mock("@/lib/api", () => ({
  api: { get: jest.fn() },
  fetchOIChange: jest.fn(),
}));

describe("captureLandingPlanSnapshot", () => {
  beforeEach(() => {
    api.get.mockReset();
    fetchOIChange.mockReset();
  });

  it("captures only shared, whitelisted app feeds and never requests member data", async () => {
    fetchOIChange.mockResolvedValue({
      current: {
        index: "NIFTY",
        timestamp: "2026-10-15T08:00:00Z",
        expiry: "2026-10-22",
        price: 22500,
        atm: 22500,
        strikes: [{ strike: 22500, ce_oi: 1000, pe_oi: 2000, ce_ltp: 10, pe_ltp: 12 }],
      },
      previous: { strikes: [] },
      data_status: { label: "LIVE", is_live: true },
    });
    api.get.mockImplementation((path) => {
      if (path.includes("/straddle/")) return Promise.resolve({ data: { trade_date: "2026-10-15", history: [{ ts: "2026-10-15T08:00:00Z", premium: 22, internal_note: "discard" }] } });
      if (path.startsWith("/events/")) return Promise.resolve({ data: { events: [{ event_date: "2026-10-20", event_type: "Results", symbol: "TEST", upload_meta: "discard" }], join: { secret: "discard" } } });
      if (path === "/market-intel") return Promise.resolve({ data: { items: [{
        id: "story-1",
        title: "Captured story",
        description: "Current feed",
        source_name: "Publisher One",
        article_url: "https://publisher.test/story",
        member_id: "discard",
      }] } });
      if (path === "/global-markets/overview") return Promise.resolve({ data: { enabled: true, categories: ["GLOBAL INDICES"], items: [{ id: "idx-1", symbol: "Nikkei", price: 38000, access_token: "discard" }] } });
      if (path === "/desk-outside") return Promise.resolve({ data: {
        quote_source: "Kite",
        updated_at: "2026-10-15T08:00:00Z",
        movers: [{
          index: "NIFTY",
          symbol: "HDFCBANK",
          pct: 0.54,
          weightage: 12.4,
          price: 1768.3,
          buyer: "discard",
          seller: "discard",
          member_id: "discard",
        }],
        breadth: { NIFTY: { n: 50, adv: 31, dec: 19, above_vwap: 28, private_note: "discard" } },
      } });
      if (path === "/holidays") return Promise.resolve({ data: { holidays: [{ date: "2026-12-25", name: "Christmas", owner: "discard" }] } });
      if (path === "/alerts") return Promise.resolve({ data: { alerts: [{ index: "NIFTY", created_at: "2026-10-15T08:00:00Z", message: "Shared publisher alert", severity: "high", member_id: "discard" }] } });
      throw new Error(`Unexpected request ${path}`);
    });

    const snapshot = await captureLandingPlanSnapshot(new Date("2026-10-15T08:05:00Z"));

    expect(snapshot.indices.NIFTY.oi_change.current.strikes).toEqual([
      { strike: 22500, ce_oi: 1000, pe_oi: 2000, ce_ltp: 10, pe_ltp: 12 },
    ]);
    expect(snapshot.indices.NIFTY.straddle.data.history).toEqual([
      { ts: "2026-10-15T08:00:00Z", premium: 22 },
    ]);
    expect(snapshot.indices.NIFTY.events.data).toEqual({
      events: [{ event_date: "2026-10-20", event_type: "Results", symbol: "TEST" }],
    });
    expect(snapshot.market_intel.data.items[0]).toEqual({
      id: "story-1",
      title: "Captured story",
      description: "Current feed",
    });
    expect(snapshot.global_markets.data.items[0]).toEqual({
      id: "idx-1",
      symbol: "Nikkei",
      price: 38000,
    });
    expect(snapshot.desk_market.data).toEqual({
      updated_at: "2026-10-15T08:00:00Z",
      movers: [{
        index: "NIFTY",
        symbol: "HDFCBANK",
        pct: 0.54,
        weightage: 12.4,
        price: 1768.3,
      }],
      breadth: { NIFTY: { n: 50, adv: 31, dec: 19, above_vwap: 28 } },
    });
    expect(snapshot.holidays.data.holidays[0]).toEqual({ date: "2026-12-25", name: "Christmas" });
    expect(snapshot.activity.data.items[0].title).toBe("Shared publisher alert");
    expect(api.get.mock.calls.map(([path]) => path)).toContain("/alerts");
    expect(api.get.mock.calls.map(([path]) => path)).toContain("/desk-outside");
    expect(api.get.mock.calls.map(([path]) => path)).not.toContain("/membership/alerts");
    expect(api.get.mock.calls.map(([path]) => path)).not.toContain("/positions");
    expect(api.get.mock.calls.map(([path]) => path)).not.toContain("/journal");
    expect(JSON.stringify(snapshot)).not.toMatch(/member_id|access_token|secret|upload_meta|owner|buyer|seller|private_note|Publisher One|publisher\.test|quote_source|Kite/);
  });

  it("preserves unavailable index feeds as unavailable in a partial capture", async () => {
    fetchOIChange.mockRejectedValue(new Error("feed offline"));
    api.get.mockImplementation((path) => path === "/holidays"
      ? Promise.resolve({ data: { holidays: [] } })
      : Promise.reject(new Error("feed offline")));

    const snapshot = await captureLandingPlanSnapshot(new Date("2026-10-15T08:05:00Z"));

    expect(snapshot.indices.NIFTY.oi_change.status).toBe("unavailable");
    expect(snapshot.indices.NIFTY.straddle.status).toBe("unavailable");
    expect(snapshot.indices.NIFTY.events.status).toBe("unavailable");
    expect(snapshot.market_intel.status).toBe("unavailable");
    expect(snapshot.desk_market.status).toBe("unavailable");
    expect(snapshot.holidays.status).toBe("captured");
    expect(snapshot.activity.status).toBe("unavailable");
  });

  it("uses the built-in NSE calendar when the Admin holiday endpoint is unavailable", async () => {
    fetchOIChange.mockRejectedValue(new Error("feed offline"));
    api.get.mockRejectedValue(new Error("feed offline"));

    const snapshot = await captureLandingPlanSnapshot(new Date("2026-10-14T08:05:00Z"));

    expect(snapshot.holidays.status).toBe("captured");
    expect(snapshot.holidays.data.source).toBe("built-in NSE calendar");
    expect(snapshot.holidays.data.holidays).toContainEqual({
      date: "2026-10-20",
      name: "Dussehra",
    });
    expect(snapshot.holidays.data.holidays.some((holiday) => holiday.name.includes("Illustrative"))).toBe(false);
  });
});
