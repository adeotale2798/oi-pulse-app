import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import TabHideContextMenu from "./TabHideContextMenu";

describe("TabHideContextMenu", () => {
  let container;
  let root;
  let onHide;
  let onSelect;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    onHide = jest.fn();
    onSelect = jest.fn();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.querySelectorAll("[data-testid^='tab-hide-menu-']").forEach((menu) => menu.remove());
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
    jest.useRealTimers();
  });

  const render = () => {
    act(() => {
      root.render(
        <TabHideContextMenu tabId="oi" label="OI" canHide onHide={onHide}>
          <button type="button" onClick={onSelect}>OI</button>
        </TabHideContextMenu>,
      );
    });
  };

  it("opens a text-only Hide action from the desktop context menu", () => {
    render();
    const event = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: 80,
      clientY: 40,
    });
    act(() => container.querySelector("button").dispatchEvent(event));

    const action = document.querySelector("[data-testid='tab-hide-action-oi']");
    expect(event.defaultPrevented).toBe(true);
    expect(action.textContent).toBe("Hide OI");
    expect(container.querySelector("button").textContent).toBe("OI");

    act(() => action.click());
    expect(onHide).toHaveBeenCalledWith("oi");
  });

  it("opens on a touch long press without also changing the selected tab", () => {
    jest.useFakeTimers();
    render();
    const tab = container.querySelector("button");
    const pointerDown = new Event("pointerdown", { bubbles: true });
    Object.defineProperties(pointerDown, {
      pointerType: { value: "touch" },
      clientX: { value: 90 },
      clientY: { value: 44 },
    });
    act(() => tab.dispatchEvent(pointerDown));
    act(() => jest.advanceTimersByTime(550));

    expect(document.querySelector("[data-testid='tab-hide-action-oi']")).not.toBeNull();
    const pointerUp = new Event("pointerup", { bubbles: true });
    act(() => tab.dispatchEvent(pointerUp));
    act(() => tab.click());
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("opens the page action from the keyboard context-menu shortcut", () => {
    render();
    const event = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "F10",
      shiftKey: true,
    });
    act(() => container.querySelector("button").dispatchEvent(event));

    expect(event.defaultPrevented).toBe(true);
    expect(document.querySelector("[data-testid='tab-hide-action-oi']")).not.toBeNull();
  });
});
