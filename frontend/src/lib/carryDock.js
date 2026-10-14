/** Carry brief dock side. Default left on desktop; user can flip or drag. */

export const CARRY_DOCK_KEY = "oiCarryBriefDock";
export const CARRY_LEFT_KEY = "oiCarryBriefLeftPx";
export const CARRY_PANEL_WIDTH = 560;
export const CARRY_PANEL_HEIGHT = 520;
export const CARRY_PANEL_WIDTH_KEY = "oiCarryBriefWidthPx";
export const CARRY_PANEL_HEIGHT_KEY = "oiCarryBriefHeightPx";
export const MI_POPUP_LEFT_KEY = "oiMiPopupLeftPx";
export const MI_POPUP_WIDTH_KEY = "oiMiPopupWidthPx";
export const MI_POPUP_HEIGHT_KEY = "oiMiPopupHeightPx";
export const FLOATING_DOCK_SIDE_EVENT = "oi-floating-dock-side";
export const MI_PANEL_WIDTH = 420;
export const MI_PANEL_HEIGHT = 480;

export function normalizeCarryDockSide(value) {
  return value === "right" ? "right" : "left";
}

export function clampCarryLeft(px, viewportWidth, panelWidth = CARRY_PANEL_WIDTH) {
  const w = Number(viewportWidth) || 1200;
  const width = Math.min(panelWidth, Math.max(240, w - 16));
  const max = Math.max(8, w - width - 8);
  const n = Number(px);
  if (!Number.isFinite(n)) return 12;
  return Math.min(max, Math.max(8, n));
}

export function snapCarryLeft(mode, viewportWidth, panelWidth = CARRY_PANEL_WIDTH) {
  const w = Number(viewportWidth) || 1200;
  const width = Math.min(panelWidth, Math.max(240, w - 16));
  if (mode === "right") return clampCarryLeft(w - width - 12, w, panelWidth);
  if (mode === "center") return clampCarryLeft(Math.round((w - width) / 2), w, panelWidth);
  return 12;
}

export function snapDockFromClientX(clientX, viewportWidth) {
  const w = Number(viewportWidth) || 0;
  const x = Number(clientX);
  if (!Number.isFinite(x) || w <= 0) return "left";
  if (x < w / 3) return "left";
  if (x > (2 * w) / 3) return "right";
  return "center";
}

export function readCarryDockSide() {
  try {
    return normalizeCarryDockSide(localStorage.getItem(CARRY_DOCK_KEY));
  } catch {
    return "left";
  }
}

export function writeCarryDockSide(side) {
  try {
    localStorage.setItem(CARRY_DOCK_KEY, normalizeCarryDockSide(side));
  } catch {
    /* ignore */
  }
}

export function readCarryLeft() {
  try {
    const n = Number(localStorage.getItem(CARRY_LEFT_KEY));
    if (Number.isFinite(n) && n >= 8 && n <= 4000) return n;
  } catch {
    /* ignore */
  }
  return null;
}

export function writeCarryLeft(px) {
  try {
    localStorage.setItem(CARRY_LEFT_KEY, String(Math.round(px)));
  } catch {
    /* ignore */
  }
}

function readSavedPanelWidth(key, fallback) {
  try {
    const width = Number(localStorage.getItem(key));
    if (Number.isFinite(width) && width >= 240 && width <= 1200) return width;
  } catch {
    // Use the default size when browser storage is unavailable.
  }
  return fallback;
}

/** Keep floating docks below the ticker / Kite API header. */
export function deskHeaderClearance() {
  if (typeof document === "undefined") return 88;
  let top = 56;
  for (const sel of [
    "[data-testid='dashboard-header']",
    ".oi-header",
    "[data-testid='kite-maintenance-banner']",
    "[data-testid='kite-token-banner']",
  ]) {
    const el = document.querySelector(sel);
    if (!el) continue;
    const r = el.getBoundingClientRect();
    if (r.height > 0) top = Math.max(top, r.bottom);
  }
  return Math.min(220, Math.max(56, Math.round(top + 8)));
}

export function moveOpposingDock(source, side, viewportWidth) {
  if (side !== "left" && side !== "right") return null;
  const isMarketIntel = source === "market-intel";
  const target = isMarketIntel ? "overnight" : "market-intel";
  const targetSide = side === "left" ? "right" : "left";
  const targetWidth = isMarketIntel
    ? readSavedPanelWidth(CARRY_PANEL_WIDTH_KEY, CARRY_PANEL_WIDTH)
    : readSavedPanelWidth(MI_POPUP_WIDTH_KEY, MI_PANEL_WIDTH);
  const targetLeft = snapCarryLeft(targetSide, viewportWidth, targetWidth);
  const key = isMarketIntel ? CARRY_LEFT_KEY : MI_POPUP_LEFT_KEY;
  const bottomKey = isMarketIntel ? "oiCarryBriefBottomPx" : "oiMiPopupBottomPx";
  try {
    localStorage.setItem(key, String(Math.round(targetLeft)));
    localStorage.setItem(bottomKey, "12");
  } catch {
    // The in-memory position still synchronizes if browser storage is unavailable.
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(FLOATING_DOCK_SIDE_EVENT, {
      detail: { target, left: targetLeft, bottom: 12 },
    }));
  }
  return targetLeft;
}

/**
 * CSS `bottom` so the panel top (drag handle) stays below the header.
 * `panelHeight` is the rendered height of the chip or sheet.
 */
export function clampDockBottom(raw, viewportHeight, opts = {}) {
  const vh = Number(viewportHeight) || 800;
  const min = Math.max(8, Number(opts.minBottom) || 12);
  const header = Math.max(48, Number(opts.headerClearance) || 88);
  const h = Math.max(40, Number(opts.panelHeight) || 48);
  const max = Math.max(min, vh - header - h);
  const n = Number(raw);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

export function clampFloatingPanelSize(width, height, viewportWidth, viewportHeight, opts = {}) {
  const vw = Math.max(1, Number(viewportWidth) || 1200);
  const vh = Math.max(1, Number(viewportHeight) || 800);
  const header = Math.max(0, Number(opts.headerClearance) || 88);
  const bottom = Math.max(0, Number(opts.bottomClearance) || 12);
  const maxWidth = Math.max(1, Math.min(Number(opts.maxWidth) || 720, vw - 16));
  const maxHeight = Math.max(1, Math.min(
    Number(opts.maxHeight) || 620,
    vh - header - bottom - 16,
  ));
  const minWidth = Math.min(Number(opts.minWidth) || 320, maxWidth);
  const minHeight = Math.min(Number(opts.minHeight) || 220, maxHeight);
  const requestedWidth = Number(width);
  const requestedHeight = Number(height);
  return {
    width: Math.round(Math.min(maxWidth, Math.max(minWidth, Number.isFinite(requestedWidth) ? requestedWidth : Number(opts.defaultWidth) || 420))),
    height: Math.round(Math.min(maxHeight, Math.max(minHeight, Number.isFinite(requestedHeight) ? requestedHeight : Number(opts.defaultHeight) || 480))),
  };
}
