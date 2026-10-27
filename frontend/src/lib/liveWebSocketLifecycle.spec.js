import { connectSpotWS } from "./spotWs";
import { connectStraddleWS } from "./straddleWs";

jest.mock("@/lib/siteWalkthroughApi", () => ({
  isSiteWalkthroughPath: () => false,
}));

describe("live WebSocket reconnection lifecycle", () => {
  let originalWebSocket;
  let sockets;

  beforeEach(() => {
    jest.useFakeTimers();
    originalWebSocket = global.WebSocket;
    sockets = [];
    global.WebSocket = class FakeWebSocket {
      constructor(url) {
        this.url = url;
        sockets.push(this);
      }

      close() {
        this.onclose?.();
      }
    };
  });

  afterEach(() => {
    global.WebSocket = originalWebSocket;
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  const connectFeed = (kind) => (
    kind === "spot"
      ? connectSpotWS(() => {}, undefined, undefined, { allowDuringQuiescent: true })
      : connectStraddleWS(
        "NIFTY",
        {},
        () => {},
        undefined,
        undefined,
        { allowDuringQuiescent: true },
      )
  );

  it.each(["spot", "straddle"])("%s reconnect stops after its owner unmounts", (kind) => {
    const connection = connectFeed(kind);
    sockets[0].onclose();
    expect(jest.getTimerCount()).toBe(1);

    connection.stop();
    jest.advanceTimersByTime(60_000);

    expect(sockets).toHaveLength(1);
    expect(connection.isStarted()).toBe(false);
  });

  it.each(["spot", "straddle"])("%s still reconnects while its owner is active", (kind) => {
    const connection = connectFeed(kind);
    sockets[0].onclose();
    jest.advanceTimersByTime(1000);

    expect(sockets).toHaveLength(2);
    connection.stop();
  });
});
