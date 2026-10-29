import { api } from "@/lib/api";
import { clearIndexEventsCache, fetchIndexEvents } from "./indexEventsApi";

jest.mock("@/lib/api", () => ({
  api: { get: jest.fn() },
}));

describe("index event request cache", () => {
  beforeEach(() => {
    clearIndexEventsCache();
    api.get.mockReset();
  });

  it("shares the in-flight request between dashboard event surfaces", async () => {
    let resolveRequest;
    api.get.mockReturnValue(new Promise((resolve) => {
      resolveRequest = resolve;
    }));

    const first = fetchIndexEvents("NIFTY");
    const second = fetchIndexEvents("NIFTY");
    expect(api.get).toHaveBeenCalledTimes(1);
    resolveRequest({ data: { events: [] } });
    await expect(first).resolves.toMatchObject({ events: [] });
    await expect(second).resolves.toMatchObject({ events: [] });
  });

  it("keeps admin diagnostics separate from the public event response", async () => {
    api.get
      .mockResolvedValueOnce({
        data: {
          events: [],
          join: { matched_rows: 1 },
          events_source_filename: "private.csv",
        },
      })
      .mockResolvedValueOnce({ data: { events: [], join: { matched_rows: 1 } } });

    const publicData = await fetchIndexEvents("NIFTY");
    const adminData = await fetchIndexEvents("NIFTY", { includeJoin: true });

    expect(api.get).toHaveBeenCalledTimes(2);
    expect(publicData.join).toBeNull();
    expect(publicData.events_source_filename).toBeUndefined();
    expect(adminData.join).toEqual({ matched_rows: 1 });
  });

  it("does not cache invalid responses or rejected requests", async () => {
    api.get
      .mockResolvedValueOnce({ data: {} })
      .mockRejectedValueOnce(new Error("network unavailable"))
      .mockResolvedValueOnce({ data: { events: [] } });

    await expect(fetchIndexEvents("NIFTY")).rejects.toThrow("response was invalid");
    await expect(fetchIndexEvents("NIFTY")).rejects.toThrow("network unavailable");
    await expect(fetchIndexEvents("NIFTY")).resolves.toMatchObject({ events: [] });
    expect(api.get).toHaveBeenCalledTimes(3);
  });
});
