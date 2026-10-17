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
});
