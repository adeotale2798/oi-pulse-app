import {
  loadPublicEntryAuthState,
  normalizePublicEntryAuthTimeout,
  PUBLIC_ENTRY_AUTH_TIMEOUT_DEFAULT_SECONDS,
} from "@/lib/authBoot";

describe("public entry auth timeout", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("normalizes invalid values and clamps configured values", () => {
    expect(normalizePublicEntryAuthTimeout(5)).toBe(5);
    expect(normalizePublicEntryAuthTimeout(90)).toBe(60);
    expect(normalizePublicEntryAuthTimeout("20")).toBe(PUBLIC_ENTRY_AUTH_TIMEOUT_DEFAULT_SECONDS);
    expect(normalizePublicEntryAuthTimeout(null)).toBe(PUBLIC_ENTRY_AUTH_TIMEOUT_DEFAULT_SECONDS);
  });

  it("uses the saved duration without waiting for the boot-config request first", async () => {
    const api = {
      get: jest.fn((path) => {
        if (path === "/public/boot-config") {
          return Promise.resolve({ data: { public_entry_auth_timeout_seconds: 5 } });
        }
        return new Promise(() => {});
      }),
    };

    const result = loadPublicEntryAuthState(api);
    const rejected = expect(result).rejects.toMatchObject({ code: "ECONNABORTED" });
    await Promise.resolve();
    await Promise.resolve();
    expect(api.get.mock.calls.map(([path]) => path)).toEqual([
      "/public/boot-config",
      "/auth/state",
    ]);
    jest.advanceTimersByTime(4999);
    await Promise.resolve();
    await Promise.resolve();
    jest.advanceTimersByTime(1);
    await rejected;
  });

  it("uses the default and warns when boot config cannot be loaded", async () => {
    const warning = jest.spyOn(console, "warn").mockImplementation(() => {});
    const api = {
      get: jest.fn((path) => (
        path === "/public/boot-config"
          ? Promise.reject(new Error("config unavailable"))
          : new Promise(() => {})
      )),
    };

    const result = loadPublicEntryAuthState(api);
    const rejected = expect(result).rejects.toMatchObject({ code: "ECONNABORTED" });
    await Promise.resolve();
    await Promise.resolve();
    expect(warning).toHaveBeenCalled();
    jest.advanceTimersByTime(PUBLIC_ENTRY_AUTH_TIMEOUT_DEFAULT_SECONDS * 1000 - 1);
    await Promise.resolve();
    jest.advanceTimersByTime(1);
    await rejected;
  });
});
