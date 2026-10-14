import React, { act } from "react";
import { createRoot } from "react-dom/client";
import Landing from "@/pages/Landing";
import { api, fetchExtras, fetchTickers } from "@/lib/api";

jest.mock("react-router-dom", () => {
  const ReactModule = require("react");
  const navigate = jest.fn();
  return {
    Link: ({ to, children, ...props }) => ReactModule.createElement("a", { href: to, ...props }, children),
    useNavigate: () => navigate,
  };
});

jest.mock("framer-motion", () => {
  const ReactModule = require("react");
  const motion = new Proxy({}, {
    get: (_target, tag) => ReactModule.forwardRef(({
      initial, animate, transition, whileInView, viewport, exit, ...props
    }, ref) => ReactModule.createElement(tag, { ...props, ref })),
  });
  return { motion, AnimatePresence: ({ children }) => children };
});

jest.mock("@/lib/api", () => ({
  api: { get: jest.fn() },
  fetchOIChange: jest.fn(),
  fetchTickers: jest.fn(),
  fetchExtras: jest.fn(),
}));

jest.mock("@/hooks/useLiveDemo", () => ({
  __esModule: true,
  default: () => ({
    indices: {
      NIFTY: { price: 25_000, changePct: 0.2 },
      BANKNIFTY: { price: 55_000, changePct: -0.1 },
      SENSEX: { price: 82_000, changePct: 0.3 },
    },
    chain: { atm: 25_000 },
    pressure: 60,
    pcr: 1.1,
  }),
}));

jest.mock("@/components/landing/BrowserMock", () => ({ id }) => (
  <div className="slz-browser" data-testid={`browser-mock-${id}`}>
    <div className="slz-browser-address">striklenz.com/dashboard</div>
  </div>
));
jest.mock("@/components/landing/ShotTour", () => () => null);
jest.mock("@/components/landing/PlanWalkthrough", () => () => "Interactive plan walkthrough");
jest.mock("@/components/ui/dialog", () => {
  const ReactModule = require("react");
  return {
    Dialog: ({ open, children }) => open ? ReactModule.createElement("div", { "data-testid": "plan-dialog" }, children) : null,
    DialogContent: ({ children }) => ReactModule.createElement("div", null, children),
    DialogDescription: ({ children }) => ReactModule.createElement("p", null, children),
    DialogTitle: ({ children }) => ReactModule.createElement("h2", null, children),
  };
});

function siteConfig(planMoreInfoEnabled = true, offerPrice = null) {
  const premium = { monthly: 999, quarterly: 2499, yearly: 7999 };
  if (offerPrice !== null) premium.offer_prices = { monthly: offerPrice };
  return {
    data: {
      pricing: {
        currency: "INR",
        premium,
        pro: { monthly: 1999, quarterly: 4999, yearly: 15999 },
      },
      membership: {
        experience_enabled: true,
        signup_enabled: true,
        paid_subscriptions_enabled: true,
        plans: {
          normal: { enabled: true, features: ["oi_change", "open_interest"] },
          premium: { enabled: true, features: ["oi_change", "alerts", "market_intel", "global_markets"] },
          pro: { enabled: true, features: ["positions", "trade_journal", "desk_ai"] },
        },
      },
      features: { google_login_enabled: true },
      landing_page: { plan_more_info_enabled: planMoreInfoEnabled },
    },
  };
}

describe("public landing page plan details", () => {
  let container;
  let root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    api.get.mockReset();
    fetchTickers.mockReset();
    fetchTickers.mockResolvedValue({ tickers: [] });
    fetchExtras.mockReset();
    fetchExtras.mockResolvedValue({});
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  });

  async function renderLanding(enabled, offerPrice = null, walkthroughEnabled = true) {
    api.get.mockImplementation((path) => {
      if (path === "/public/site-config") return Promise.resolve(siteConfig(enabled, offerPrice));
      if (path.startsWith("/public/landing-plan-screenshots/")) {
        return Promise.resolve({ data: { screenshots: [] } });
      }
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });
    await act(async () => {
      root.render(<Landing walkthroughEnabled={walkthroughEnabled} />);
    });
  }

  it("shows the named plan features and all More info buttons when enabled", async () => {
    await renderLanding(true);

    expect(container.querySelector(".slz-orbit-core")).toBeNull();
    expect(container.textContent).toContain("Straddle");
    expect(container.textContent).toContain("Market & Global Events");
    expect(container.textContent).not.toContain("OI Distribution");
    expect(container.querySelectorAll("[data-testid^='pricing-more-info-']")).toHaveLength(3);
    expect(container.querySelector("[data-testid='pricing-features-normal']").textContent).toContain("OI Change dashboard");
    expect(container.querySelector("[data-testid='pricing-features-premium']").textContent).toContain("Market Intel");
    expect(container.querySelector("[data-testid='pricing-features-pro']").textContent).toContain("Your open positions");

    await act(async () => {
      container.querySelector("[data-testid='pricing-more-info-normal']").click();
    });

    expect(container.querySelector("[data-testid='plan-dialog']")).not.toBeNull();
    expect(container.textContent).toContain("Start with the shared OI desk");
    expect(api.get).toHaveBeenCalledWith("/public/landing-plan-screenshots/normal");
  });

  it("hides all More info buttons and does not load plan details when disabled", async () => {
    await renderLanding(false);

    expect(container.querySelectorAll("[data-testid^='pricing-more-info-']")).toHaveLength(0);
    expect(container.querySelector("[data-testid='pricing-features-premium']").textContent).toContain("Market Intel");
    expect(api.get).toHaveBeenCalledTimes(1);
    expect(api.get).toHaveBeenCalledWith("/public/site-config");
  });

  it("shows the regular price diagonally struck through beside the configured first-period price", async () => {
    await renderLanding(true, 799);

    expect(container.querySelector('[data-testid="pricing-original-price-premium"]').textContent).toContain("₹999");
    expect(container.querySelector('[data-testid="pricing-offer-price-premium"]').textContent).toContain("₹799");
    expect(container.querySelector('[data-testid="pricing-original-price-pro"]')).toBeNull();
  });

  it("uses Basic for the free plan and hides demo entry points when the walkthrough is disabled", async () => {
    await renderLanding(true, null, false);

    expect(container.querySelector(".slz-section-heading")).not.toBeNull();
    expect(container.textContent).toContain("Basic");
    expect(container.textContent).not.toContain("Explore demo");
    expect(container.textContent).not.toContain("Explore interactive demo");
  });

  it("shows the five required symbols and every additional admin-enabled index in the market ticker", async () => {
    fetchTickers.mockResolvedValue({
      tickers: [
        { index: "NIFTY", label: "NIFTY 50", ltp: 25_000, change_pct: 0.25 },
        { index: "BANKNIFTY", label: "BANK NIFTY", ltp: 55_000, change_pct: -0.1 },
        { index: "SENSEX", label: "SENSEX", ltp: 82_000, change_pct: 0.3 },
        { index: "FINNIFTY", label: "FINNIFTY", ltp: 26_000, change_pct: 0.2 },
        { index: "CRUDEOIL", label: "CRUDEOIL", ltp: 6_500, change_pct: -0.4 },
      ],
    });
    fetchExtras.mockResolvedValue({
      vix: { last: 14.2, change_pct: -2.5 },
      gift_nifty: { last: 25_100, change_pct: 0.4 },
    });
    await renderLanding(true);

    const tickerItems = [...container.querySelectorAll("[data-testid='landing-market-ticker-item']")].slice(0, 7);
    expect(tickerItems.map((item) => item.dataset.tickerKey)).toEqual([
      "NIFTY", "BANKNIFTY", "SENSEX", "INDIAVIX", "GIFTNIFTY", "FINNIFTY", "CRUDEOIL",
    ]);
    expect(tickerItems[3].textContent).toContain("14.20");
    expect(tickerItems[4].textContent).toContain("25,100.00");
    expect(fetchTickers).toHaveBeenCalled();
    expect(fetchExtras).toHaveBeenCalled();
  });

  it("keeps all five required ticker labels visible when the quote endpoints are unavailable", async () => {
    fetchTickers.mockRejectedValue(new Error("Ticker service unavailable"));
    fetchExtras.mockRejectedValue(new Error("Extras service unavailable"));
    await renderLanding(true);

    const tickerItems = [...container.querySelectorAll("[data-testid='landing-market-ticker-item']")].slice(0, 5);
    expect(tickerItems.map((item) => item.dataset.tickerKey)).toEqual([
      "NIFTY", "BANKNIFTY", "SENSEX", "INDIAVIX", "GIFTNIFTY",
    ]);
    expect(tickerItems.every((item) => item.textContent.includes("—"))).toBe(true);
  });

  it("keeps the animated sample preview shadow visible before the ticker", async () => {
    await renderLanding(true);

    const ticker = container.querySelector("[data-testid='landing-market-ticker']");
    const hero = ticker.previousElementSibling;
    expect(hero.className).toContain("overflow-x-clip");
    expect(hero.className).toContain("overflow-y-visible");
    expect(hero.className).toContain("pb-20");
    expect(hero.className).toContain("md:pb-24");
    expect(ticker.className).toContain("slz-market-ticker");
  });

  it("shows the Pro showcase with a fictional PositionMeter preview instead of the Desk AI tile", async () => {
    await renderLanding(true);

    expect(container.querySelector('[data-testid="landing-analyze-preview"]')).not.toBeNull();
    for (const tileId of ["pro-market-intel-tile", "pro-journal-tile", "pro-position-meter-tile"]) {
      const tile = container.querySelector(`[data-testid="${tileId}"]`);
      expect(tile).not.toBeNull();
      expect(tile.querySelector(".slz-browser-address")).toBeNull();
      expect(tile.querySelector(".slz-browser-bar")).toBeNull();
    }
    expect(container.querySelector("#pro [data-testid='browser-mock-market-intel']")).toBeNull();
    expect(container.querySelector("#pro [data-testid='browser-mock-journal']")).toBeNull();
    expect(container.querySelector("#pro [data-testid='market-intel-preview']")).not.toBeNull();
    expect(container.querySelector("#pro [data-testid='trade-journal-preview']")).not.toBeNull();
    const meter = container.querySelector("#pro [data-testid='position-meter-preview']");
    expect(meter).not.toBeNull();
    expect(meter.textContent).toContain("PositionMeter");
    expect(meter.textContent).toContain("Daily loss & margin guard");
    expect(meter.textContent).toContain("Fictional sample");
    expect(meter.querySelectorAll("article")).toHaveLength(3);
    expect(meter.textContent.match(/Same-strike bought quantity/g)).toHaveLength(1);
    expect(container.textContent).toContain("Scenario P&L · payoff shape · spot sensitivity");
    expect(meter.innerHTML).not.toContain("text-[6px]");
    expect(container.querySelector("#pro [data-testid='desk-ai-preview']")).toBeNull();
  });

  it("uses the concise live-intelligence hero label and consolidated Desk AI copy", async () => {
    await renderLanding(true);

    expect(container.querySelector(".slz-chip").textContent).toContain("Live options intelligence");
    expect(container.querySelector(".slz-chip").textContent).not.toMatch(/NIFTY|SENSEX/);
    expect(container.textContent).toContain("Desk AI brings Market Intel, Global Markets and Indian index movers together");
    expect(container.textContent).not.toContain("does not analyze your positions or provide trade instructions");
    expect(container.textContent).not.toContain("It uses the publisher's shared market feed and does not require a broker login.");
  });

  it("uses consistent brand-accent section headings and the split-color StrikLenz plan heading", async () => {
    await renderLanding(true);

    for (const heading of [
      "main h1",
      "#features h2",
      "#product h2",
      "#pro h2",
      "#pricing h2",
      "#faq h2",
    ]) {
      expect(container.querySelector(heading).className).toContain("slz-section-heading");
    }
    expect(container.querySelector("#pricing h2 .slz-brand-strik").textContent).toBe("Strik");
    expect(container.querySelector("#pricing h2 .slz-brand-lenz").textContent).toBe("Lenz");
    expect(container.querySelector("#pricing [aria-label='Billing interval']")).not.toBeNull();
    expect(container.querySelector("#faq button").getAttribute("aria-expanded")).toBe("true");
  });

  it("shows mobile and tablet compatibility between feature tiles and the product demo", async () => {
    await renderLanding(true);

    const compatibility = container.querySelector('[data-testid="mobile-tablet-compatibility"]');
    expect(compatibility.textContent).toContain("Mobile / Tablet compatible");
    expect(container.querySelector("#features").contains(compatibility)).toBe(true);
    expect(container.querySelector("#product").className).toContain("pt-8");
  });
});
