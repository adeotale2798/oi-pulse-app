import { brokerSafeText } from "./brokerCopy";

/** Map broker connection failures into a desk-readable sentence. */

export function extractRequestToken(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  const m = s.match(/[?&]request_token=([^&\s#]+)/i);
  if (m) {
    try {
      return decodeURIComponent(m[1]);
    } catch {
      return m[1];
    }
  }
  return s.split(/\s+/)[0];
}

export function httpErrorDetail(err) {
  const d = err?.response?.data?.detail ?? err?.response?.data?.message;
  if (typeof d === "string") return d;
  if (Array.isArray(d)) return d.map((x) => x?.msg || x?.message || String(x)).join("; ");
  if (d && typeof d === "object") return d.msg || d.message || JSON.stringify(d);
  return String(err?.message || "");
}

export function friendlyKiteConnectError(raw) {
  const text = String(raw || "");
  const low = text.toLowerCase();
  if (low.includes("not enabled for the app")) {
    return (
      "This broker account is not enabled for the configured app. " +
      "Ask the desk administrator to check the account's access."
    );
  }
  if (low.includes("checksum")) {
    return (
      "The API key and secret do not match. Check the saved broker app credentials, then try again."
    );
  }
  if (
    low.includes("tokenexception")
    || low.includes("already used")
    || low.includes("invalid token")
    || (low.includes("token") && (low.includes("invalid") || low.includes("expired") || low.includes("used")))
  ) {
    return (
      "This request token was already used or expired. Start a new broker login and paste the new code immediately — it works only once."
    );
  }
  return brokerSafeText(text) || "Broker login failed";
}
