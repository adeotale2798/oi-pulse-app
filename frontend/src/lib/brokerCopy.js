const PROVIDER_NAMES = /\b(?:zerodha\s*(?:\/|and)?\s*kite(?:\s*connect)?|kite\s*connect|kiteticker|zerodha|kite)\b/gi;
const PROVIDER_HOSTS = /\b(?:developers\.)?kite\.tech\b|\b(?:api\.)?kite\.trade\b|\bkite\.zerodha\.com\b|\bzerodha\.com\b/gi;
const PROVIDER_URLS = /https?:\/\/[^\s"'<>]*(?:kite\.tech|kite\.trade|kite\.zerodha\.com|zerodha\.com)[^\s"'<>]*/gi;

export function brokerSafeText(value) {
  return String(value ?? "")
    .replace(PROVIDER_URLS, "broker service")
    .replace(PROVIDER_HOSTS, "broker service")
    .replace(PROVIDER_NAMES, "broker");
}
