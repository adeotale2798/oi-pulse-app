import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { api } from "@/lib/api";
import MarketMemoryCard from "./MarketMemoryCard";

jest.mock("@/components/ui/button", () => ({
  Button: ({ children, ...props }) => <button {...props}>{children}</button>,
}));
jest.mock("@/components/ui/sheet", () => ({
  Sheet: ({ children }) => <div>{children}</div>,
  SheetContent: ({ children }) => <div>{children}</div>,
  SheetHeader: ({ children }) => <div>{children}</div>,
  SheetTitle: ({ children }) => <div>{children}</div>,
}));
jest.mock("@/components/InfoTip", () => ({
  __esModule: true,
  default: ({ children }) => <span>{children}</span>,
}));
jest.mock("@/components/DataLoadingState", () => ({
  __esModule: true,
  default: ({ label }) => <span role="status">{label}</span>,
}));

jest.mock("@/lib/api", () => ({
  api: { get: jest.fn() },
}));

const summary = {
  index: "NIFTY",
  price: 25100,
  freshnessSeconds: 8,
  levels: [{
    level: 25100,
    levelType: "SUPPORT",
    strength: "MEDIUM",
    touchCount: 2,
    rejectionCount: 1,
    breakoutCount: 1,
    failedBreakoutCount: 1,
    averageReaction: 12.5,
    largestReaction: 18.399999999999977,
    recentAverageReaction: 6.2,
    historicalAverageReaction: 9.399999999999977,
    averageSignedReaction: -2,
    averageUpReaction: 23.80000000000029,
    averageDownReaction: -176.1999999999971,
    failedBreakoutRate: 25,
    failureRate: 25,
    currentDistance: 223.8000000000029,
  }],
};

describe("MarketMemoryCard", () => {
  let container;
  let root;

  beforeEach(() => {
    jest.useFakeTimers();
    api.get.mockReset();
    container = document.createElement("div");
    root = createRoot(container);
    global.IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    act(() => root.unmount());
    jest.useRealTimers();
  });

  it("refreshes its summary every 30 seconds without discarding the last success", async () => {
    api.get.mockResolvedValueOnce({ data: summary }).mockRejectedValueOnce(new Error("offline"));

    await act(async () => {
      root.render(<MarketMemoryCard index="NIFTY" marketOpen={false} />);
    });
    expect(container.textContent).toContain("25,100");
    expect(container.textContent).toContain("5d avg 6.2 pts");
    expect(container.textContent).toContain("25% failed retests");
    expect(container.textContent).toContain("Market closed");
    expect(container.textContent).toContain("SUPPORT");
    expect(container.textContent).toContain("Direction");
    expect(container.textContent).toContain("223.8 pts");
    expect(container.textContent).toContain("up +23.8 pts · down -176.2 pts");
    expect(container.textContent).not.toContain("223.8000000000029");
    expect(container.textContent).not.toContain("176.1999999999971");

    await act(async () => {
      jest.advanceTimersByTime(30_000);
    });
    expect(api.get).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("Could not refresh");
    expect(container.textContent).toContain("25,100");
  });

  it("keeps member market memory descriptive without directional level labels", async () => {
    api.get.mockResolvedValue({ data: summary });
    await act(async () => {
      root.render(<MarketMemoryCard index="NIFTY" neutralOnly />);
    });

    expect(container.textContent).toContain("HISTORICAL LEVEL");
    expect(container.textContent).toContain("25,100");
    expect(container.textContent).not.toMatch(/\b(SUPPORT|RESISTANCE|Direction|up|down)\b/i);
    expect(container.textContent).toContain("not a forecast or trade signal");
  });

  it("does not keep refreshing after it unmounts", async () => {
    api.get.mockResolvedValue({ data: summary });
    await act(async () => {
      root.render(<MarketMemoryCard index="NIFTY" />);
    });
    expect(api.get).toHaveBeenCalledTimes(1);

    act(() => root.unmount());
    await act(async () => {
      jest.advanceTimersByTime(60_000);
    });
    expect(api.get).toHaveBeenCalledTimes(1);
    root = createRoot(container);
  });
});
