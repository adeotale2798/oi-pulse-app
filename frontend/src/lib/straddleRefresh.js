import { isMarketQuiescent } from "./marketTimes.js";
import { isFullHolidayIST, isTradingDayIST, todayIST } from "./holidays.js";

function istYmd(now) {
  if (!now) return todayIST();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  const d = parts.find((p) => p.type === "day")?.value;
  return `${y}-${m}-${d}`;
}

/**
 * Live ATM straddle refresh (countdown + poll) only during the cash/F&O session
 * for the chart's selected IST trade date. Historical views stay frozen.
 */
export function straddleLiveRefreshActive(now = new Date(), tradeDate = null) {
  const iso = istYmd(now instanceof Date ? now : new Date(now));
  if (tradeDate && String(tradeDate).slice(0, 10) !== iso) return false;
  if (!isTradingDayIST(iso)) return false;
  if (isFullHolidayIST(iso)) return false;
  return !isMarketQuiescent(now instanceof Date ? now : new Date(now));
}

export function straddleRefreshLabel(live, ageSeconds, pollMs) {
  if (!live) return null;
  const pollS = Math.max(1, Math.round(Number(pollMs) / 1000) || 15);
  const age = Math.max(0, Math.round(Number(ageSeconds) || 0));
  const rem = pollS - (age % pollS);
  const left = rem === 0 ? pollS : rem;
  return `next (${left}s)`;
}

export function straddleWsDataFresh(lastDataAt, now, pollMs) {
  const last = Number(lastDataAt);
  const current = Number(now);
  const interval = Number(pollMs);
  if (
    !Number.isFinite(last) ||
    last <= 0 ||
    !Number.isFinite(current) ||
    !Number.isFinite(interval) ||
    interval <= 0 ||
    current < last
  ) {
    return false;
  }
  return current - last <= interval * 2;
}

export function shouldAcceptLiveStraddlePoint(point, previous, now, maxAgeMs) {
  const timestamp = Number(point?.ts);
  const current = Number(now);
  const maxAge = Number(maxAgeMs);
  if (
    !Number.isFinite(timestamp) ||
    timestamp <= 0 ||
    !Number.isFinite(current) ||
    !Number.isFinite(maxAge) ||
    maxAge <= 0 ||
    timestamp > current ||
    current - timestamp > maxAge
  ) {
    return false;
  }
  if (Number.isFinite(Number(previous?.ts)) && timestamp < Number(previous.ts)) {
    return false;
  }

  const premium = Number(point?.premium);
  const previousPremium = Number(previous?.premium);
  if (previousPremium > 0) {
    if (premium > Math.max(previousPremium * 3, previousPremium + 200)) return false;
    if (premium < previousPremium * 0.35 && premium < 10 && previousPremium > 20) return false;
  }
  return true;
}
