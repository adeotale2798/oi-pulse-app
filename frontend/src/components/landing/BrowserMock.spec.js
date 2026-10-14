import React, { act } from "react";
import { createRoot } from "react-dom/client";
import BrowserMock from "./BrowserMock";
import ShotFrame from "./ShotFrame";

describe("landing price chips", () => {
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

  it("keeps the address, preview badge, and price chips legible in the browser frame", async () => {
    const snap = {
      indices: {
        SENSEX: { price: 84937.99, changePct: 0.01 },
        NIFTY: { price: 25837.99, changePct: 0.01 },
      },
    };
    await act(async () => {
      root.render(
        <>
          <BrowserMock snap={snap} />
          <ShotFrame src="data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=" snap={snap} chipIndex="SENSEX" />
        </>,
      );
    });

    const chips = container.querySelectorAll('[data-testid="landing-price-chip"]');
    expect(chips).toHaveLength(2);
    expect(container.querySelectorAll(".slz-browser-address")).toHaveLength(2);
    expect(container.querySelectorAll(".slz-browser-route")).toHaveLength(2);
    expect(container.querySelector(".slz-browser-status").getAttribute("aria-label"))
      .toBe("Illustrative sample preview");
    expect(container.querySelectorAll(".slz-browser-status-wide")).toHaveLength(2);
    expect(container.querySelectorAll(".slz-browser-status-compact")).toHaveLength(2);
    chips.forEach((chip) => {
      expect(chip.className).not.toContain("absolute");
      expect(chip.parentElement.className).toContain("border-b");
      expect(chip.lastElementChild.className).toContain("shrink-0");
      expect(chip.lastElementChild.className).toContain("whitespace-nowrap");
      expect(chip.lastElementChild.textContent).toMatch(/^[+-]\d+\.\d{2}%$/);
    });
  });
});
