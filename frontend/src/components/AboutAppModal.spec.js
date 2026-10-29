import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { api } from "@/lib/api";
import { ABOUT_EVENT } from "@/lib/appVersion";
import AboutAppModal from "./AboutAppModal";

jest.mock("@/lib/api", () => ({
  api: { get: jest.fn() },
}));

jest.mock("@/components/ui/dialog", () => {
  const React = require("react");
  const passthrough = ({ children, ...props }) => {
    delete props.open;
    delete props.onOpenChange;
    return React.createElement("div", props, children);
  };
  return {
    Dialog: ({ open, children }) => (open ? <div>{children}</div> : null),
    DialogContent: passthrough,
    DialogHeader: passthrough,
    DialogTitle: passthrough,
    DialogDescription: passthrough,
  };
});

jest.mock("@/components/OiPulseLogo", () => () => null);
jest.mock("@/lib/releaseNotes", () => ({
  RELEASE_NOTES: [{
    version: "20.80",
    date: "2026-10-29",
    user: ["Example user change"],
    admin: ["Example internal change"],
  }],
}));
jest.mock("@/lib/brokerCopy", () => ({
  brokerSafeText: (text) => text,
}));

describe("AboutAppModal access", () => {
  let container;
  let root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    global.IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    jest.clearAllMocks();
  });

  it("shows release details only for a server-confirmed Admin", async () => {
    api.get.mockResolvedValue({ data: { is_admin: true } });
    await act(async () => root.render(<AboutAppModal />));

    await act(async () => {
      window.dispatchEvent(new CustomEvent(ABOUT_EVENT));
    });

    expect(container.querySelector('[data-testid="about-app-modal"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="about-release-notes"]')).not.toBeNull();
    expect(container.textContent).toContain("Example internal change");
  });

  it.each(["Free", "Premium", "Pro"])("%s users keep the details panel closed", async () => {
    api.get.mockResolvedValue({ data: { is_admin: false } });
    await act(async () => root.render(<AboutAppModal />));

    await act(async () => {
      window.dispatchEvent(new CustomEvent(ABOUT_EVENT));
    });

    expect(container.querySelector('[data-testid="about-app-modal"]')).toBeNull();
    expect(container.querySelector('[data-testid="about-release-notes"]')).toBeNull();
  });

  it("keeps the details panel closed if the auth check fails", async () => {
    api.get.mockRejectedValue(new Error("Auth unavailable"));
    await act(async () => root.render(<AboutAppModal />));

    await act(async () => {
      window.dispatchEvent(new CustomEvent(ABOUT_EVENT));
    });

    expect(container.querySelector('[data-testid="about-app-modal"]')).toBeNull();
  });
});
