import React, { act } from "react";
import { createRoot } from "react-dom/client";
import MobileStickyChrome from "./MobileStickyChrome";

describe("MobileStickyChrome hidden-page control", () => {
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
    activeIndex: "NIFTY",
    indices: ["NIFTY"],
    tabs: [{ v: "oi", l: "Open Interest" }],
    activeTab: "oi",
    onSelectIndex: jest.fn(),
    onChangeTab: jest.fn(),
    onHideTab: jest.fn(),
    onRestoreTab: jest.fn(),
  };

  it("does not render the restore control when no pages are hidden", async () => {
    await act(async () => {
      root.render(<MobileStickyChrome {...baseProps} hiddenTabs={[]} />);
    });

    expect(container.querySelector('[data-testid="dashboard-add-page-mobile"]')).toBeNull();
  });

  it("renders and opens the restore menu when a page is hidden", async () => {
    await act(async () => {
      root.render(
        <MobileStickyChrome
          {...baseProps}
          hiddenTabs={[{ v: "buildup", l: "Build-up" }]}
        />,
      );
    });

    const button = container.querySelector('[data-testid="dashboard-add-page-mobile"]');
    expect(button).not.toBeNull();

    await act(async () => {
      button.click();
    });

    const menu = document.body.querySelector('[data-testid="dashboard-hidden-pages-menu-mobile"]');
    expect(menu).not.toBeNull();
    expect(menu.textContent).toContain("Build-up");
  });
});
