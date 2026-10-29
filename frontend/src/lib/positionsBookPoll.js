/** Keep GET /positions alive through NSE and MCX sessions, plus after-hours discovery. */

import { istMinutesOfDay, getMarketOpenMinute, getPositionsCatchupMinute } from "./marketTimes.js";
import {
  isJournalSessionDayIST,
  specialSessionOpenMinute,
  specialSessionCatchupMinute,
} from "./holidays.js";

function isoIST(now) {
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

function nthWeekdayOfMonth(year, month, weekday, occurrence) {
  const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  return 1 + ((weekday - first + 7) % 7) + (occurrence - 1) * 7;
}

function isUsDstDate(iso) {
  const year = Number(iso.slice(0, 4));
  const month = Number(iso.slice(5, 7));
  const day = Number(iso.slice(8, 10));
  const starts = nthWeekdayOfMonth(year, 3, 0, 2);
  const ends = nthWeekdayOfMonth(year, 11, 0, 1);
  const dateKey = month * 100 + day;
  return dateKey >= 300 + starts && dateKey < 1100 + ends;
}

function mcxCloseMinute(iso, group = "mcx_non_agri") {
  if (group === "mcx_agri") return 17 * 60;
  if (group === "mcx_select_agri") return 21 * 60;
  return isUsDstDate(iso) ? 23 * 60 + 30 : 23 * 60 + 55;
}

function isMcxRow(row) {
  return String(row?.exchange || "").toUpperCase().startsWith("MCX")
    || String(row?.segment || "").toUpperCase().startsWith("MCX");
}

function mcxRows(payload) {
  return Array.isArray(payload?.positions) ? payload.positions.filter(isMcxRow) : [];
}

function mcxRowIsInSession(row, now, iso) {
  const minutes = istMinutesOfDay(now);
  const group = String(row?.session_group || "mcx_non_agri").toLowerCase();
  return minutes >= 9 * 60 && minutes < mcxCloseMinute(iso, group) + 5;
}

function isMcxDiscoveryWindow(now, iso) {
  const minutes = istMinutesOfDay(now);
  return minutes >= 9 * 60 && minutes < mcxCloseMinute(iso) + 5;
}

function isNsePositionsWindow(now, iso) {
  const minutes = istMinutesOfDay(now);
  const open = specialSessionOpenMinute(iso) ?? getMarketOpenMinute();
  const catchup = specialSessionCatchupMinute(iso) ?? getPositionsCatchupMinute();
  return minutes >= open && minutes < catchup;
}

export function shouldPollPositionsBook(now = new Date(), payload = null) {
  const iso = isoIST(now);
  if (!isJournalSessionDayIST(iso)) return false;
  if (isNsePositionsWindow(now, iso)) return true;
  // A low-rate scan lets new MCX trades started after the NSE close enter the book.
  return payload?.kite_connected !== false && isMcxDiscoveryWindow(now, iso);
}

export function shouldLivePollPositionsBook(now = new Date(), payload = null) {
  const iso = isoIST(now);
  if (!isJournalSessionDayIST(iso)) return false;
  if (isNsePositionsWindow(now, iso)) return true;
  return mcxRows(payload).some(
    (row) => !row.exited && Number(row.quantity) !== 0 && mcxRowIsInSession(row, now, iso),
  );
}

export function openLiveCount(payload) {
  const rows = payload?.positions;
  if (!Array.isArray(rows)) return 0;
  return rows.filter((r) => !r.exited && Number(r.quantity) !== 0).length;
}

export const POSITIONS_BOOK_LIVE_MS = 2000;
export const POSITIONS_BOOK_IDLE_MS = 15000;
export const POSITIONS_BOOK_BOOT_MS = 1500;
export const POSITIONS_BOOK_MIN_MS = 1000;
export const POSITIONS_BOOK_MAX_MS = 3_600_000;

export function clampPositionsBookPollMs(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return POSITIONS_BOOK_LIVE_MS;
  return Math.max(POSITIONS_BOOK_MIN_MS, Math.min(POSITIONS_BOOK_MAX_MS, Math.round(n)));
}

export function positionsBookPollDelayMs({
  hasPayload,
  sessionOpen,
  pollMs,
  requestStartedAt,
  now = Date.now(),
}) {
  if (!hasPayload) return POSITIONS_BOOK_BOOT_MS;
  if (!sessionOpen) return 60_000;
  if (!requestStartedAt) return pollMs;
  return Math.max(0, pollMs - (now - requestStartedAt));
}
