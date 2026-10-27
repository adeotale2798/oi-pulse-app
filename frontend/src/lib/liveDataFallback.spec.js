import { shouldReplaceSpotQuote } from "./indexQuotes";
import { shouldRunPollImmediately } from "./pollingLifecycle";
import {
  straddleWsDataFresh,
  shouldAcceptLiveStraddlePoint,
} from "./straddleRefresh";

describe("dashboard live-data fallback", () => {
  it("uses REST spot data when it is newer than the last WebSocket quote", () => {
    expect(
      shouldReplaceSpotQuote(
        { price: 100, asOf: "2026-10-27T09:15:01Z" },
        { price: 101, asOf: "2026-10-27T09:15:02Z" },
      ),
    ).toBe(true);
  });

  it("does not let a delayed REST response replace a newer WebSocket quote", () => {
    expect(
      shouldReplaceSpotQuote(
        { price: 101, asOf: "2026-10-27T09:15:02Z" },
        { price: 100, asOf: "2026-10-27T09:15:01Z" },
      ),
    ).toBe(false);
  });

  it("rejects zero or invalid spot prices", () => {
    expect(
      shouldReplaceSpotQuote(
        { price: 101, asOf: "2026-10-27T09:15:02Z" },
        { price: 0, asOf: "2026-10-27T09:15:03Z" },
      ),
    ).toBe(false);
  });

  it("uses REST Straddle polling when a WebSocket has never delivered data", () => {
    expect(straddleWsDataFresh(0, 1000, 15000)).toBe(false);
  });

  it("keeps a fresh Straddle WebSocket tick from duplicating the REST request", () => {
    expect(straddleWsDataFresh(1000, 30000, 15000)).toBe(true);
  });

  it("resumes REST polling when Straddle WebSocket ticks become stale", () => {
    expect(straddleWsDataFresh(1000, 31001, 15000)).toBe(false);
  });

  it("rejects stale Straddle payloads even when they arrive over an open socket", () => {
    expect(
      shouldAcceptLiveStraddlePoint(
        { ts: 1000, premium: 80 },
        { ts: 1000, premium: 80 },
        31001,
        30000,
      ),
    ).toBe(false);
  });

  it("does not accept an outlier as a valid Straddle WebSocket tick", () => {
    expect(
      shouldAcceptLiveStraddlePoint(
        { ts: 2000, premium: 500 },
        { ts: 1000, premium: 80 },
        2000,
        30000,
      ),
    ).toBe(false);
  });

  it("accepts a current in-session Straddle tick", () => {
    expect(
      shouldAcceptLiveStraddlePoint(
        { ts: 2000, premium: 85 },
        { ts: 1000, premium: 80 },
        2000,
        30000,
      ),
    ).toBe(true);
  });

  it("rejects out-of-order Straddle points without advancing feed freshness", () => {
    expect(
      shouldAcceptLiveStraddlePoint(
        { ts: 1000, premium: 80 },
        { ts: 2000, premium: 82 },
        2000,
        30000,
      ),
    ).toBe(false);
  });

  it("immediately runs REST-backed feeds when market status reopens", () => {
    expect(
      shouldRunPollImmediately({
        hasRun: true,
        wasQuiescent: true,
        isQuiescent: false,
      }),
    ).toBe(true);
  });

  it("does not trigger duplicate immediate polls during open-market rerenders", () => {
    expect(
      shouldRunPollImmediately({
        hasRun: true,
        wasQuiescent: false,
        isQuiescent: false,
      }),
    ).toBe(false);
  });
});
