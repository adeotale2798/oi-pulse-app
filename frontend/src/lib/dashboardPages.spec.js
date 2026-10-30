import { pageAllowed, sanitizePageList } from "./dashboardPages";

describe("Admin-only dashboard pages", () => {
  it("allows Sell Candidates on the Admin desk but never for members or guests", () => {
    expect(pageAllowed("sell-candidates", {
      isAdmin: true,
      adminPages: ["sell-candidates"],
    })).toBe(true);
    expect(pageAllowed("sell-candidates", {
      isAdmin: false,
      visiblePages: ["sell-candidates"],
    })).toBe(false);
    expect(pageAllowed("sell-candidates", {
      isAdmin: false,
      visiblePages: ["sell-candidates"],
      pagesReady: false,
    })).toBe(false);
  });

  it("strips candidate-page IDs from public lists and preserves Admin lists", () => {
    expect(sanitizePageList(["sell-candidates", "oi-change"])).toEqual(["oi-change"]);
    expect(sanitizePageList(["sell-candidates"])).toEqual(["oi-change"]);
    expect(sanitizePageList(["sell-candidates", "oi-change"], undefined, true))
      .toEqual(["sell-candidates", "oi-change"]);
  });
});
