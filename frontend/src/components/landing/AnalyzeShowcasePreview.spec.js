import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import AnalyzeShowcasePreview from "./AnalyzeShowcasePreview";

describe("AnalyzeShowcasePreview", () => {
  it("shows the Pro Analyze experience with clearly fictional scenario data", () => {
    const markup = renderToStaticMarkup(<AnalyzeShowcasePreview />);

    expect(markup).toContain('data-testid="landing-analyze-preview"');
    expect(markup).toContain("Analyze");
    expect(markup).toContain("Fictional sample");
    expect(markup).toContain("Sample legs");
    expect(markup).toContain("Scenario summary");
    expect(markup).toContain("Synthetic example only");
    expect(markup).not.toContain("Shared open-interest context");
  });
});
