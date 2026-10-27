// Lightweight reconnection wrapper for Straddle WebSocket
import { isSiteWalkthroughPath } from "@/lib/siteWalkthroughApi";

export function connectStraddleWS(index, opts = {}, onMessage, onOpen, onClose, options = {}) {
  if (isSiteWalkthroughPath()) {
    return { stop: () => {}, isStarted: () => false };
  }
  const { allowDuringQuiescent = false } = options;
  let urlOrigin = "";
  try {
    // Try to use REACT_APP_BACKEND_URL environment variable first
    const backendUrl = process.env.REACT_APP_BACKEND_URL;
    if (backendUrl) {
      urlOrigin = backendUrl.replace(/^https:/, "wss:").replace(/^http:/, "ws:");
    } else {
      const o = window.location.origin;
      if (o.startsWith("https://")) urlOrigin = o.replace(/^https:/, "wss:");
      else urlOrigin = o.replace(/^http:/, "ws:");
    }
  } catch {
    urlOrigin = "ws://localhost:8000";
  }
  const params = new URLSearchParams();
  if (opts.expiry) params.set("expiry", opts.expiry);
  if (opts.position) params.set("position", opts.position);
  if (opts.qty) params.set("qty", String(opts.qty));
  // Admin token for WS auth (query param required by browser WS API).
  // Never log the full URL — tokens would leak to DevTools / log shippers.
  try {
    const tok = sessionStorage.getItem("oi_admin_token");
    if (tok) params.set("admin_token", tok);
  } catch (_) {}

  const wsUrl = `${urlOrigin}/api/ws/straddle/${encodeURIComponent(index)}?${params.toString()}`;
  if (process.env.NODE_ENV !== "production") {
    const safe = new URLSearchParams(params);
    if (safe.has("admin_token")) safe.set("admin_token", "[redacted]");
    console.log(
      "[Straddle WS] Connecting to:",
      `${urlOrigin}/api/ws/straddle/${encodeURIComponent(index)}?${safe.toString()}`,
    );
  }

  let ws = null;
  let stopped = false;
  let backoff = 1000;
  let started = false;
  let reconnectTimer = null;

  // Avoid connecting during quiescent periods unless explicitly allowed.
  // Instead, watch for market reopen and auto-start when it happens.
  let watcherId = null;
  if (!allowDuringQuiescent) {
    try {
      const { isMarketQuiescent } = require("@/lib/marketTimes");
      if (isMarketQuiescent()) {
        if (process.env.NODE_ENV !== "production") {
          console.info("[Straddle WS] Market quiescent: deferring WS connect and watching for reopen");
        }
        watcherId = setInterval(() => {
          try {
            if (!isMarketQuiescent()) {
              clearInterval(watcherId);
              watcherId = null;
              start();
            }
          } catch (e) {
            // ignore
          }
        }, 30_000);
        return { stop, isStarted: () => started };
      }
    } catch (e) {
      // fallthrough
    }
  }

  function scheduleReconnect() {
    if (stopped || reconnectTimer) return;
    // Keep retries cancellable so a stopped feed cannot reconnect after unmount.
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      if (stopped) return;
      backoff = Math.min(30000, backoff * 1.5);
      start();
    }, backoff);
  }

  function start() {
    if (stopped) return;
    try {
      ws = new WebSocket(wsUrl);
      ws.onopen = () => {
        if (stopped) return;
        started = true;
        if (process.env.NODE_ENV !== "production") {
          console.log("[Straddle WS] Connected");
        }
        backoff = 1000;
        if (onOpen) onOpen();
      };
      ws.onmessage = (ev) => {
        if (stopped) return;
        try { const d = JSON.parse(ev.data); if (onMessage) onMessage(d); } catch (e) { console.error("[Straddle WS] Parse error:", e); }
      };
      ws.onclose = () => {
        started = false;
        if (process.env.NODE_ENV !== "production") {
          console.log("[Straddle WS] Closed, reconnecting in", backoff, "ms");
        }
        if (onClose) onClose();
        if (stopped) return;
        scheduleReconnect();
      };
      ws.onerror = (err) => {
        console.error("[Straddle WS] Error:", err);
        try { ws && ws.close(); } catch (_) {} 
      };
    } catch (e) {
      console.error("[Straddle WS] Failed to create WebSocket:", e);
      scheduleReconnect();
    }
  }

  function stop() {
    stopped = true;
    started = false;
    try { ws && ws.close(); } catch (_) {}
    if (watcherId) { clearInterval(watcherId); watcherId = null; }
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  }
  start();
  return { stop, isStarted: () => started };
}
