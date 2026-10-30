import { api, clearGuestAuth, persistGuestAuth } from "@/lib/api";

describe("member session persistence", () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    window.history.replaceState({}, "", "/dashboard");
  });

  afterEach(() => {
    clearGuestAuth();
  });

  it("restores the persisted member token in the legacy auth header after a tab restart", async () => {
    persistGuestAuth({
      token: "member-session-token",
      name: "Returning Member",
      expiresInSeconds: 30 * 24 * 60 * 60,
    });
    sessionStorage.clear();

    let outgoingConfig;
    const response = await api.get("/auth/state", {
      adapter: async (config) => {
        outgoingConfig = config;
        return {
          data: { is_member: true },
          status: 200,
          statusText: "OK",
          headers: {},
          config,
        };
      },
    });

    expect(localStorage.getItem("oi_guest_token")).toBe("member-session-token");
    expect(outgoingConfig.headers.get("X-Guest-Token")).toBe("member-session-token");
    expect(response.data.is_member).toBe(true);
  });
});
