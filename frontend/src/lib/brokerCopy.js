const PROVIDER_NAMES = /\b(?:zerodha\s*(?:\/|and)?\s*kite(?:\s*connect)?|kite\s*connect|kiteticker|zerodha|kite)\b/gi;
const PROVIDER_HOSTS = /\b(?:developers\.)?kite\.tech\b|\b(?:api\.)?kite\.trade\b|\bkite\.zerodha\.com\b|\bzerodha\.com\b/gi;
const PROVIDER_URLS = /https?:\/\/[^\s"'<>]*(?:kite\.tech|kite\.trade|kite\.zerodha\.com|zerodha\.com)[^\s"'<>]*/gi;

export function brokerSafeText(value) {
  const raw = String(value ?? "");
  if (/text\/html|<!doctype\s+html|<html\b|<body\b/i.test(raw)) {
    return /(?:\b503\b|service unavailable)/i.test(raw)
      ? "Broker service is temporarily unavailable. Please try again shortly."
      : "Broker service returned an unexpected response. Please try again shortly.";
  }
  return raw
    .replace(PROVIDER_URLS, "broker service")
    .replace(PROVIDER_HOSTS, "broker service")
    .replace(PROVIDER_NAMES, "broker");
}
