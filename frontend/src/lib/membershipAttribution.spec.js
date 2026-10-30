import {
  captureMembershipAttribution,
  clearMembershipAttribution,
  readMembershipAttribution,
} from "@/lib/membershipAttribution";

function fakeStorage() {
  const values = new Map();
  return {
    getItem: jest.fn((key) => values.get(key) || null),
    setItem: jest.fn((key, value) => values.set(key, value)),
    removeItem: jest.fn((key) => values.delete(key)),
  };
}

describe("membership signup attribution", () => {
  it("keeps bounded first-touch campaign fields and only an external origin", () => {
    const storage = fakeStorage();
    const result = captureMembershipAttribution(
      "?utm_source=search&utm_campaign=launch",
      "https://news.example/article?email=private%40example.com",
      "striklenz.com",
      storage,
    );

    expect(result).toEqual({
      utm_source: "search",
      utm_campaign: "launch",
      referrer: "https://news.example",
    });
    expect(storage.setItem.mock.calls[0][1]).not.toContain("private");
    expect(readMembershipAttribution(storage)).toEqual(result);
  });

  it("does not replace first-touch data and can clear it after sign-in", () => {
    const storage = fakeStorage();
    captureMembershipAttribution("?utm_source=first", "", "striklenz.com", storage);
    const later = captureMembershipAttribution("?utm_source=second", "", "striklenz.com", storage);

    expect(later).toEqual({ utm_source: "first" });
    expect(storage.setItem).toHaveBeenCalledTimes(1);
    clearMembershipAttribution(storage);
    expect(readMembershipAttribution(storage)).toEqual({});
  });
});
