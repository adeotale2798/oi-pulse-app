import React, { act } from "react";
import { createRoot } from "react-dom/client";
import ShotTour from "./ShotTour";

describe("ShotTour", () => {
  let container;
  let root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  });

  it("uses selectable page previews without a Play control or duplicate Market Structure view", async () => {
    await act(async () => {
      root.render(<ShotTour snap={{
        indices: {
          NIFTY: { price: 25810, changePct: 0.12 },
          BANKNIFTY: { price: 56408, changePct: 0.06 },
          SENSEX: { price: 84851, changePct: -0.09 },
        },
        pressure: 62,
        pcr: 0.92,
      }} />);
    });

    expect(container.querySelector("button[aria-label='Play']")).toBeNull();
    expect(container.textContent).not.toContain("Market Structure");
    expect(Array.from(container.querySelectorAll("button")).slice(0, 3).map((button) => button.textContent)).toEqual([
      "Straddle", "Strike Pressure", "Trade Journal",
    ]);
    expect(container.querySelector('[data-testid="landing-straddle-preview"]')).not.toBeNull();
    expect(Array.from(container.querySelectorAll("button")).some((button) => button.textContent === "Dashboard")).toBe(false);
    expect(Array.from(container.querySelectorAll("button")).some((button) => button.textContent === "OI Change")).toBe(true);
    expect(container.textContent).toContain("SAMPLE PREVIEW");
    expect(container.querySelector(".slz-browser-address-text").textContent).toContain("striklenz.com/dashboard");

    const initialStraddle = container.querySelector('[data-testid="landing-straddle-preview"]');
    expect(initialStraddle).not.toBeNull();
    expect(initialStraddle.textContent).toContain("₹336.00");
    const oiChange = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent === "OI Change");
    await act(async () => oiChange.click());
    await act(async () => new Promise((resolve) => setTimeout(resolve, 450)));
    expect(container.textContent).toContain("OI Change");
    const oiChart = container.querySelector('[data-testid="landing-oi-chart"]');
    expect(oiChart).not.toBeNull();
    expect(oiChart.dataset.strikeCount).toBe("11");
    expect(oiChart.dataset.hasAtm).toBe("true");
    expect(oiChart.textContent).toContain("11 strikes");
    expect(oiChart.querySelectorAll("circle")).toHaveLength(0);
    expect(oiChart.textContent).toContain("Put OI");
    expect(oiChart.textContent).toContain("Call OI");
    expect(container.textContent).toContain("28 Sep");
    expect(container.textContent).toContain("Monthly");
    expect(container.textContent).not.toMatch(/\b(Bullish|Bearish|Support|Resist)\b/);

    const pressureTab = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent === "Strike Pressure");
    await act(async () => pressureTab.click());
    await act(async () => new Promise((resolve) => setTimeout(resolve, 450)));
    const pressure = container.querySelector('[data-testid="landing-strike-pressure"]');
    expect(pressure.textContent).toContain("Call-side OI");
    expect(pressure.textContent).toContain("Put-side OI");
    expect(pressure.textContent).toContain("Largest listed strike");
    expect(pressure.textContent).toContain("writers leading OI");
    expect(pressure.textContent).toContain("9:15 → close");
    expect(pressure.textContent).toContain("Fictional session sample");
    expect(pressure.querySelector('[data-testid="landing-strike-pressure-meter"]')).not.toBeNull();
    expect(pressure.textContent).not.toContain("writers in control");
    expect(pressure.querySelector('[role="meter"]').getAttribute("aria-valuenow")).toMatch(/^\d+$/);

    await act(async () => {
      root.render(<ShotTour snap={{
        indices: {
          NIFTY: { price: 25810, changePct: 0.12 },
          BANKNIFTY: { price: 56408, changePct: 0.06 },
          SENSEX: { price: 84851, changePct: -0.09 },
        },
        pressure: 62,
        pcr: 0.92,
      }} />);
    });

    const globalMarkets = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent === "Global Markets");
    await act(async () => globalMarkets.click());
    await act(async () => new Promise((resolve) => setTimeout(resolve, 450)));
    expect(container.textContent).toContain("ADR Monitor");
    expect(container.textContent).toContain("Fictional sample data");

    const straddle = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent === "Straddle");
    await act(async () => straddle.click());
    await act(async () => new Promise((resolve) => setTimeout(resolve, 450)));
    expect(container.querySelector('[data-testid="landing-straddle-preview"]')).not.toBeNull();
    expect(container.textContent).toContain("Illustrative session path · not live");
    expect(container.textContent).toContain("₹336.00");

    const events = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent === "Market & Global Events");
    await act(async () => events.click());
    await act(async () => new Promise((resolve) => setTimeout(resolve, 450)));
    expect(container.querySelector('[data-testid="landing-market-events-preview"]')).not.toBeNull();
    expect(container.textContent).toContain("RBI policy decision");
    expect(container.textContent).toContain("US CPI release");

    const deskAi = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent === "Desk AI");
    await act(async () => deskAi.click());
    await act(async () => new Promise((resolve) => setTimeout(resolve, 450)));
    expect(container.textContent).toContain("Market session briefing");
    expect(container.textContent).toContain("Heavyweight moves");
    expect(container.textContent).toContain("One consolidated briefing across Market Intel, Global Markets");
    expect(container.textContent).not.toContain("never accesses, analyzes or comments on your broker positions");
    expect(container.querySelector("input")).toBeNull();

    const journal = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent === "Trade Journal");
    await act(async () => journal.click());
    await act(async () => new Promise((resolve) => setTimeout(resolve, 450)));
    expect(container.textContent).toContain("Monthly trade calendar");
    expect(container.textContent).toContain("Weekly recap");
    expect(container.textContent).toContain("Fictional sample");

    const marketIntel = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent === "Market Intel");
    await act(async () => marketIntel.click());
    await act(async () => new Promise((resolve) => setTimeout(resolve, 450)));
    expect(container.querySelector('[data-testid="market-intel-preview"]')).not.toBeNull();
    expect(container.textContent).toContain("Importance 94");
    expect(container.textContent).toContain("India impact");

    const oilFilter = Array.from(container.querySelectorAll('[data-testid="market-intel-preview"] button'))
      .find((button) => button.textContent === "Oil");
    await act(async () => oilFilter.click());
    expect(container.textContent).toContain("crude-price move");
  });
});
