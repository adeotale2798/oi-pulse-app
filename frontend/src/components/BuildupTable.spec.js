import React, { act } from "react";
import { createRoot } from "react-dom/client";
import BuildupTable from "./BuildupTable";

describe("BuildupTable role presentation", () => {
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

  const current = {
    strikes: [
      { strike: 25800, ce_oi: 120000, pe_oi: 90000, ce_ltp: 110, pe_ltp: 90 },
      { strike: 25850, ce_oi: 80000, pe_oi: 110000, ce_ltp: 95, pe_ltp: 105 },
    ],
  };
  const previous = {
    strikes: [
      { strike: 25800, ce_oi: 100000, pe_oi: 100000, ce_ltp: 100, pe_ltp: 100 },
      { strike: 25850, ce_oi: 100000, pe_oi: 100000, ce_ltp: 100, pe_ltp: 100 },
    ],
  };

  it("shows measured deltas only to non-admins", async () => {
    await act(async () => {
      root.render(
        <BuildupTable
          current={current}
          previous={previous}
          atm={25800}
          timeframeLabel="15 mins"
          neutralOnly
        />,
      );
    });

    expect(container.querySelector('[data-testid="buildup-table-neutral"]')).not.toBeNull();
    expect(container.textContent).toContain("Call ΔOI %");
    expect(container.textContent).toContain("Put ΔLTP %");
    expect(container.textContent).not.toMatch(/Long Build-up|Short Build-up|Bullish|Bearish|Bias|ATM Band/i);
  });

  it("preserves Admin's existing classified build-up view", async () => {
    await act(async () => {
      root.render(
        <BuildupTable
          current={current}
          previous={previous}
          atm={25800}
          timeframeLabel="15 mins"
        />,
      );
    });

    expect(container.querySelector('[data-testid="buildup-verdict"]')).not.toBeNull();
    expect(container.textContent).toContain("Long Build-up");
    expect(container.textContent).toContain("Bias");
  });
});
