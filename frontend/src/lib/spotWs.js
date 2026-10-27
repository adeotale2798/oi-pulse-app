// Lightweight reconnection wrapper for live spot price WebSocket
import { isSiteWalkthroughPath } from "@/lib/siteWalkthroughApi";

export function connectSpotWS(onMessage, onOpen, onClose, options = {}) {
  if (isSiteWalkthroughPath()) {
    return { stop: () => {}, isStarted: () => false };
  }
  const { allowDuringQuiescent = false } = options;
  let urlOrigin = "";
  try {
    const backendUrl = process.env.REACT_APP_BACKEND_URL;
    if (backendUrl) {
      urlOrigin = backendUrl.replace(/^https:/, "wss:").replace(/^http:/, "ws:");
    } else {
      const o = window.location.origin;
      urlOrigin = o.startsWith("https://") ? o.replace(/^https:/, "wss:") : o.replace(/^http:/, "ws:");
    }
  } catch {
    urlOrigin = "ws://localhost:8000";
  }

  const wsUrl = `${urlOrigin}/api/ws/spot`;
  let ws = null;
  let stopped = false;
  let backoff = 1000;
  let started = false;
  let reconnectTimer = null;

  // If market is quiescent, avoid connecting unless explicitly allowed.
  // But watch for market reopen and auto-connect when it does.
  let watcherId = null;
  if (!allowDuringQuiescent) {
    try {
      const { isMarketQuiescent } = require("@/lib/marketTimes");
      if (isMarketQuiescent()) {
        console.info("[Spot WS] Market quiescent: deferring WS connect and watching for reopen");
        // periodically check for market reopening and start when ready
        watcherId = setInterval(() => {
          try {
            if (!isMarketQuiescent()) {
              clearInterval(watcherId);
              watcherId = null;
              start();
            }
          } catch (e) {
            // ignore and keep watching
          }
        }, 30_000);
        // return controller; start() will be invoked by watcher when market reopens
        return { stop, isStarted: () => started };
      }
    } catch (e) {
      // If marketTimes isn't available or errors, fall back to normal behavior
      // and attempt to connect as before.
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
        backoff = 1000;
        if (onOpen) onOpen();
      };
      ws.onmessage = (ev) => {
        if (stopped) return;
        try {
          const d = JSON.parse(ev.data);
          if (onMessage) onMessage(d);
        } catch (e) {
          console.error("[Spot WS] Parse error:", e);
        }
      };
      ws.onclose = () => {
        started = false;
        if (onClose) onClose();
        if (stopped) return;
        scheduleReconnect();
      };
      ws.onerror = (err) => {
        console.error("[Spot WS] Error:", err);
        try {
          ws && ws.close();
        } catch (_e) {}
      };
    } catch (e) {
      console.error("[Spot WS] Failed to create WebSocket:", e);
      scheduleReconnect();
    }
  }

  function stop() {
    stopped = true;
    started = false;
    try {
      ws && ws.close();
    } catch (_e) {}
    if (watcherId) { clearInterval(watcherId); watcherId = null; }
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  }

  start();
  return { stop, isStarted: () => started };
}
