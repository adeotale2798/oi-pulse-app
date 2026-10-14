/** Boot/auth helpers — keep a desk session through origin 520/timeouts. */

export const PUBLIC_ENTRY_AUTH_TIMEOUT_DEFAULT_SECONDS = 10;
export const PUBLIC_ENTRY_AUTH_TIMEOUT_MIN_SECONDS = 5;
export const PUBLIC_ENTRY_AUTH_TIMEOUT_MAX_SECONDS = 60;

export function normalizePublicEntryAuthTimeout(value) {
  if (!Number.isInteger(value)) return PUBLIC_ENTRY_AUTH_TIMEOUT_DEFAULT_SECONDS;
  return Math.min(
    PUBLIC_ENTRY_AUTH_TIMEOUT_MAX_SECONDS,
    Math.max(PUBLIC_ENTRY_AUTH_TIMEOUT_MIN_SECONDS, value),
  );
}

export function loadPublicEntryAuthState(api) {
  const startedAt = Date.now();
  let finished = false;
  let timeoutId;
  let rejectTimeout;
  const timeoutPromise = new Promise((_, reject) => {
    rejectTimeout = reject;
  });

  const armTimeout = (seconds) => {
    if (finished) return;
    clearTimeout(timeoutId);
    const remaining = Math.max(0, seconds * 1000 - (Date.now() - startedAt));
    timeoutId = setTimeout(() => {
      const error = new Error("public entry auth state timeout");
      error.code = "ECONNABORTED";
      rejectTimeout(error);
    }, remaining);
  };

  // Fetch the setting alongside auth, so configuration never adds another network round trip.
  armTimeout(PUBLIC_ENTRY_AUTH_TIMEOUT_DEFAULT_SECONDS);
  api.get("/public/boot-config", { timeout: 5000 })
    .then(({ data }) => armTimeout(normalizePublicEntryAuthTimeout(data?.public_entry_auth_timeout_seconds)))
    .catch((error) => {
      console.warn("Could not load the public entry timeout setting; using the 10-second default.", error);
    });

  const authRequest = api.get("/auth/state", {
    timeout: (PUBLIC_ENTRY_AUTH_TIMEOUT_MAX_SECONDS + 1) * 1000,
  });
  return Promise.race([authRequest, timeoutPromise]).finally(() => {
    finished = true;
    clearTimeout(timeoutId);
  });
}

export function isTransientHttpError(err) {
  const status = err?.response?.status;
  const code = String(err?.code || "");
  const msg = String(err?.message || "");
  if (code === "ECONNABORTED" || code === "ERR_NETWORK" || code === "ETIMEDOUT") return true;
  if (/timeout/i.test(msg) || /network error/i.test(msg)) return true;
  if (status == null) return true;
  if (status === 429 || status === 502 || status === 503 || status === 504) return true;
  if (status === 520 || status === 521 || status === 522 || status === 523 || status === 524) return true;
  return status >= 500;
}

export function storedDeskSession() {
  try {
    if (typeof sessionStorage !== "undefined" && sessionStorage.getItem("oi_admin_token")) {
      return { is_admin: true, is_guest: false };
    }
    if (typeof sessionStorage !== "undefined" && sessionStorage.getItem("oi_guest_token")) {
      return { is_admin: false, is_guest: true };
    }
    if (typeof localStorage !== "undefined" && localStorage.getItem("oi_admin_remember_token")) {
      return { is_admin: true, is_guest: false, remember: true };
    }
  } catch (_) { /* noop */ }
  return null;
}

/** Session tokens only — Remember-me still needs /auth/remember-login before API calls. */
export function liveDeskSession() {
  try {
    if (typeof sessionStorage !== "undefined" && sessionStorage.getItem("oi_admin_token")) {
      return { is_admin: true, is_guest: false };
    }
    if (typeof sessionStorage !== "undefined" && sessionStorage.getItem("oi_guest_token")) {
      return { is_admin: false, is_guest: true };
    }
  } catch (_) { /* noop */ }
  return null;
}

export function optimisticDeskAuthState() {
  const live = liveDeskSession();
  if (!live) return null;
  return {
    loading: false,
    requires_login: false,
    public_access_open: true,
    is_admin: !!live.is_admin,
    is_guest: !!live.is_guest,
    needs_guest_name: false,
  };
}

export function shouldWipeTokensOn401(url) {
  const u = String(url || "");
  if (!u.includes("/auth/")) return false;
  if (u.includes("/auth/remember-login")) return false;
  if (u.includes("/auth/login")) return false;
  if (u.includes("/auth/guest")) return false;
  if (u.includes("/auth/state")) return false;
  return true;
}

export async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

/** Never let boot wait forever on a hung origin (preview /auth/state 0-byte stall). */
export function withTimeout(promise, ms, label = "timeout") {
  let t;
  const killer = new Promise((_, reject) => {
    t = setTimeout(() => {
      const err = new Error(label);
      err.code = "ECONNABORTED";
      reject(err);
    }, ms);
  });
  return Promise.race([Promise.resolve(promise), killer]).finally(() => clearTimeout(t));
}
