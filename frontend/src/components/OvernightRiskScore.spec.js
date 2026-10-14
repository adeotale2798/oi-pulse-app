import { renderToStaticMarkup } from "react-dom/server";
import OvernightRiskScore from "./OvernightRiskScore";

describe("OvernightRiskScore", () => {
  const highRiskProps = {
    vix: 25,
    netDelta: 50,
    positionsCount: 3,
    minutesToExpiry: 60,
  };

  it("shows members a neutral factor summary instead of trade guidance", () => {
    const markup = renderToStaticMarkup(<OvernightRiskScore {...highRiskProps} />);

    expect(markup).toContain("Multiple overnight risk factors are elevated.");
    expect(markup).not.toContain("Cut or hedge before the close");
    expect(markup).not.toContain("Hold smaller into the next open");
  });

  it("preserves the existing guidance for Admin", () => {
    const markup = renderToStaticMarkup(<OvernightRiskScore {...highRiskProps} isAdmin />);

    expect(markup).toContain("Cut or hedge before the close");
  });
});
