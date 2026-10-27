import { api } from "./api";
import { fetchPositionsBook, refreshPositionsBook } from "./positionsBook";

jest.mock("./api", () => ({
  api: {
    get: jest.fn(),
  },
}));

jest.mock("./todayPnl", () => ({
  publishTodayPnl: jest.fn(),
}));

describe("positions book request lifecycle", () => {
  beforeEach(() => {
    api.get.mockReset();
  });

  it("serializes expiry settlement after an in-flight live book refresh", async () => {
    let resolveLive;
    let resolveSettlement;
    api.get
      .mockImplementationOnce(() => new Promise((resolve) => { resolveLive = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveSettlement = resolve; }));

    const liveRequest = fetchPositionsBook({ force: true });
    const settlementRequest = fetchPositionsBook({ force: true, settleExpiry: true });

    expect(api.get).toHaveBeenCalledTimes(1);

    resolveLive({ data: { positions: [] } });
    await liveRequest;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(api.get).toHaveBeenCalledTimes(2);
    expect(api.get.mock.calls[1][1].params).toEqual(
      expect.objectContaining({ settle_expiry: 1 }),
    );

    resolveSettlement({ data: { positions: [] } });
    await expect(settlementRequest).resolves.toEqual({ positions: [] });
  });

  it("retries the forced reconnect pull when an in-flight book request fails", async () => {
    let rejectLive;
    api.get
      .mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectLive = reject; }))
      .mockResolvedValueOnce({ data: { positions: [] } });

    const liveRequest = fetchPositionsBook({ force: true });
    const reconnectRequest = refreshPositionsBook();
    rejectLive(new Error("temporary network failure"));

    await expect(liveRequest).rejects.toThrow("temporary network failure");
    await expect(reconnectRequest).resolves.toEqual({ positions: [] });
    expect(api.get).toHaveBeenCalledTimes(2);
  });
});
