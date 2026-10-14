import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import AlertsPanel from "./AlertsPanel";

jest.mock("@/components/PageBrandTitle", () => ({
  __esModule: true,
  default: ({ title }) => <h2>{title}</h2>,
}));

describe("AlertsPanel", () => {
  it("labels fictional walkthrough alerts without changing live alert rows", () => {
    const markup = renderToStaticMarkup(
      <AlertsPanel
        activeIndex="NIFTY"
        canClear={false}
        alerts={[
          {
            created_at: "2026-10-06T04:00:00.000Z",
            index: "NIFTY",
            direction: "Bullish OI reversal",
            price: 24350,
            atm: 24350,
            strikes: [24300, 24350, 24400],
            sample: true,
          },
          {
            created_at: "2026-10-06T03:59:00.000Z",
            index: "NIFTY",
            direction: "Put writing",
            price: 24340,
            atm: 24350,
            strikes: [24300, 24350, 24400],
          },
        ]}
      />,
    );

    expect(markup.match(/data-testid="sample-alert-badge"/g)).toHaveLength(1);
    expect(markup).toContain("Sample");
    expect(markup).toContain("Put writing");
  });

  it("renders member OI shift alerts with their window and contract total", () => {
    const markup = renderToStaticMarkup(
      <AlertsPanel
        activeIndex="NIFTY"
        canClear={false}
        alerts={[{
          alert_id: "member-shift-1",
          type: "oi_shift",
          created_at: "2026-10-06T04:00:00.000Z",
          index: "NIFTY",
          side: "PE",
          direction: "build",
          value: 125000,
          window: 3,
          atm: 25000,
          price: 25010.5,
        }]}
      />,
    );

    expect(markup).toContain("OI Shift · PE build");
    expect(markup).toContain("1,25,000 contracts · 3 min · ATM 25000");
    expect(markup).toContain("Price 25010.50");
  });
});
