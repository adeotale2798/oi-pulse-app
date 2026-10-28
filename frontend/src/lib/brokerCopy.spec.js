import { brokerSafeText } from "./brokerCopy";

describe("brokerSafeText", () => {
  it("hides broker provider names and links in displayed copy", () => {
    expect(brokerSafeText("Zerodha Kite Connect: https://kite.zerodha.com/login"))
      .toBe("broker: broker service");
  });

  it("does not alter unrelated copy", () => {
    expect(brokerSafeText("Connect your broker account for Positions."))
      .toBe("Connect your broker account for Positions.");
  });

  it("replaces an HTML 503 response with concise maintenance copy", () => {
    expect(brokerSafeText("Unknown Content-Type (text/html): <html><body>503 Service Unavailable</body></html>"))
      .toBe("Broker service is temporarily unavailable. Please try again shortly.");
  });

  it("does not display an unexpected HTML provider response", () => {
    expect(brokerSafeText("<!doctype html><html><body>upstream response</body></html>"))
      .toBe("Broker service returned an unexpected response. Please try again shortly.");
  });
});
