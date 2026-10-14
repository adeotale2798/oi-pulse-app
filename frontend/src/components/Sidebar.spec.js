import React, { act } from "react";
import { createRoot } from "react-dom/client";
import Sidebar from "./Sidebar";

jest.mock("@/components/BigClock", () => () => <div />);
jest.mock("@/components/StrikeAroundChips", () => () => <div />);

describe("Sidebar indicative prices", () => {
  let container;
  let root;

  beforeEach(() => {
    jest.useFakeTimers();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    global.IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    jest.useRealTimers();
  });

  it("shows NIFTY and SENSEX together above the expiry list", async () => {
    await act(async () => {
      root.render(
        <Sidebar
          indices={["NIFTY", "SENSEX"]}
          activeIndex="NIFTY"
          current={{ atm: 25000 }}
          spotPrices={{}}
          expiries={[]}
          indicativeWindowOn
          indicativeQuotes={{
            NIFTY: { indicative_close_price: 25123.45, indicative_change_pct: 0.42 },
            SENSEX: { indicative_close_price: 82123.45, indicative_change_pct: -0.18 },
          }}
        />,
      );
    });

    const prices = container.querySelector('[data-testid="sidebar-iep"]');
    const expiries = container.querySelector(".sidebar-expiries");
    expect(prices).not.toBeNull();
    expect(prices.textContent).toContain("NIFTY");
    expect(prices.textContent).toContain("SENSEX");
    expect(prices.textContent).toContain("25,123.45");
    expect(prices.textContent).toContain("82,123.45");
    expect(prices.compareDocumentPosition(expiries) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
