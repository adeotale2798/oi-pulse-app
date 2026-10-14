import React, { act } from "react";
import { createRoot } from "react-dom/client";
import OverflowTabBar from "./OverflowTabBar";

describe("OverflowTabBar hidden-page control", () => {
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

  const baseProps = {
    tabs: [{ v: "oi", l: "Open Interest" }],
    value: "oi",
    onChange: jest.fn(),
    onHideTab: jest.fn(),
    onRestoreTab: jest.fn(),
  };

  it("does not render the restore control when no pages are hidden", async () => {
    await act(async () => {
      root.render(<OverflowTabBar {...baseProps} hiddenTabs={[]} />);
    });

    expect(container.querySelector('[data-testid="dashboard-add-page"]')).toBeNull();
  });

  it("keeps the restore menu available above other page layers", async () => {
    await act(async () => {
      root.render(
        <OverflowTabBar
          {...baseProps}
          hiddenTabs={[{ v: "buildup", l: "Build-up" }]}
        />,
      );
    });

    const button = container.querySelector('[data-testid="dashboard-add-page"]');
    expect(button).not.toBeNull();
    expect(button.parentElement.className).toContain("z-30");

    await act(async () => {
      button.click();
    });

    const menu = document.body.querySelector('[data-testid="dashboard-hidden-pages-menu"]');
    expect(menu).not.toBeNull();
    expect(menu.className).toContain("z-[240]");
    expect(menu.textContent).toContain("Build-up");
  });
});
