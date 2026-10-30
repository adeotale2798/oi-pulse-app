import { pageAllowed, sanitizePageList } from "./dashboardPages";

describe("retired dashboard pages", () => {
  it("never allows Sell Candidates for Admins, members, or guests", () => {
    expect(pageAllowed("sell-candidates", {
      isAdmin: true,
      adminPages: ["sell-candidates"],
    })).toBe(false);
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

  it("strips legacy candidate-page IDs from saved page lists", () => {
    expect(sanitizePageList(["sell-candidates", "oi-change"])).toEqual(["oi-change"]);
    expect(sanitizePageList(["sell-candidates"])).toEqual(["oi-change"]);
  });
});
