import { api, fetchOIChange } from "@/lib/api";
import { upcomingHolidays } from "@/lib/holidays";

const INDICES = ["NIFTY", "SENSEX", "BANKNIFTY"];
const MAX_STRADDLE_POINTS = 360;
const MAX_FEED_ITEMS = 40;

function pickFields(value, fields) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(fields
    .filter((field) => value[field] !== undefined && value[field] !== null)
    .map((field) => [field, value[field]]));
}

function isoDateIST(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function pickOiSnapshot(value) {
  if (!value || typeof value !== "object") return null;
  const strikes = Array.isArray(value.strikes)
    ? value.strikes.slice(0, 200).map((row) => pickFields(row, [
        "strike", "ce_oi", "pe_oi", "ce_ltp", "pe_ltp", "ce_volume", "pe_volume",
      ]))
    : [];
  return {
    ...pickFields(value, ["index", "timestamp", "expiry", "price", "atm"]),
    strikes,
  };
}

function pickMarketIntelItem(item) {
  return pickFields(item, [
    "id", "title", "headline", "event_title",
    "published_at", "published", "summary", "description", "india_impact",
    "india_impact_summary", "impact", "direction", "volatility", "importance",
  ]);
}

function pickGlobalMarketItem(item) {
  return pickFields(item, [
    "id", "symbol", "displayName", "category", "price", "change",
    "changePercent", "high", "low", "volume", "marketStatus", "available",
    "stale", "timestamp", "timezone", "precision",
  ]);
}

function pickDeskMarket(data) {
  const breadth = data?.breadth && typeof data.breadth === "object"
    ? Object.fromEntries(["NIFTY", "BANKNIFTY", "SENSEX"]
      .filter((index) => data.breadth[index] && typeof data.breadth[index] === "object")
      .map((index) => [index, pickFields(data.breadth[index], [
        "n", "adv", "dec", "above_vwap", "near_high", "near_low",
      ])]))
    : {};
  return {
    updated_at: data?.updated_at || null,
    movers: Array.isArray(data?.movers)
      ? data.movers.slice(0, 12).map((mover) => pickFields(mover, [
          "index", "symbol", "pct", "weightage", "price", "timestamp",
        ]))
      : [],
    breadth,
  };
}

function pickEvent(item) {
  return pickFields(item, [
    "event_date", "date", "event_type", "title", "symbol", "company_name",
    "company", "days_remaining", "weightage",
  ]);
}

function pickHoliday(item) {
  return pickFields(item, ["date", "name", "session", "open", "close"]);
}

function combineHolidays(uploadedRows, fromDate) {
  const builtIn = upcomingHolidays(fromDate);
  if (!uploadedRows.length) return builtIn.map(pickHoliday);
  const uploaded = uploadedRows.map(pickHoliday);
  const uploadedYears = new Set(uploaded.map((holiday) => holiday.date?.slice(0, 4)).filter(Boolean));
  return [
    ...builtIn.filter((holiday) => !uploadedYears.has(holiday.date.slice(0, 4))).map(pickHoliday),
    ...uploaded,
  ].sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));
}

function capturedSource(data) {
  return { status: "captured", data };
}

function unavailableSource() {
  return { status: "unavailable", data: null };
}

async function captureSource(request, pick = (data) => data) {
  try {
    const result = await request();
    const data = result?.data !== undefined ? result.data : result;
    return capturedSource(pick(data));
  } catch {
    return unavailableSource();
  }
}

async function captureIndex(index) {
  const [oiChange, straddle, events] = await Promise.all([
    captureSource(() => fetchOIChange(index, 15, { timeout: 20_000 })),
    captureSource(
      () => api.get(`/straddle/${index}/history`, { timeout: 20_000 }),
      (data) => ({
        trade_date: data?.trade_date || null,
        history: Array.isArray(data?.history)
          ? data.history.slice(-MAX_STRADDLE_POINTS).map((point) => pickFields(point, [
              "ts", "timestamp", "premium", "ce_ltp", "pe_ltp", "atm", "strike", "underlying",
            ]))
          : [],
      }),
    ),
    captureSource(
      () => api.get(`/events/${index}`, { timeout: 12_000 }),
      (data) => ({
        events: Array.isArray(data?.events) ? data.events.slice(0, 100).map(pickEvent) : [],
      }),
    ),
  ]);
  const oiData = oiChange.data;
  return {
    oi_change: oiData
      ? {
          status: oiChange.status,
          current: pickOiSnapshot(oiData.current),
          previous: pickOiSnapshot(oiData.previous),
          data_status: pickFields(oiData.data_status, ["label", "is_live", "window_minutes", "timestamp"]),
          history_ready: oiData.history_ready === true,
          available_history_minutes: oiData.available_history_minutes || [],
        }
      : unavailableSource(),
    straddle,
    events,
  };
}

export async function captureLandingPlanSnapshot(now = new Date()) {
  const indices = Object.fromEntries(
    await Promise.all(INDICES.map(async (index) => [index, await captureIndex(index)])),
  );
  const [marketIntel, globalMarkets, holidays] = await Promise.all([
    captureSource(
      () => api.get("/market-intel", { params: { filter: "all" }, timeout: 25_000 }),
      (data) => ({
        items: Array.isArray(data?.items) ? data.items.slice(0, MAX_FEED_ITEMS).map(pickMarketIntelItem) : [],
      }),
    ),
    captureSource(
      () => api.get("/global-markets/overview", { timeout: 12_000 }),
      (data) => ({
        enabled: data?.enabled !== false,
        categories: Array.isArray(data?.categories)
          ? data.categories.slice(0, 20).map((category) => typeof category === "string"
            ? category
            : pickFields(category, ["id", "name"]))
          : [],
        items: Array.isArray(data?.items) ? data.items.slice(0, MAX_FEED_ITEMS).map(pickGlobalMarketItem) : [],
        updatedAt: data?.updatedAt || null,
      }),
    ),
    (async () => {
      const fromDate = isoDateIST(now);
      try {
        const { data } = await api.get("/holidays", { timeout: 12_000 });
        return capturedSource({
          source: "uploaded and built-in app calendar",
          holidays: combineHolidays(
            (Array.isArray(data) ? data : Array.isArray(data?.holidays) ? data.holidays : [])
              .slice(0, 200),
            fromDate,
          ).slice(0, 200),
        });
      } catch {
        // The checked-in NSE calendar keeps the public preview useful if the Admin upload API is offline.
        return capturedSource({
          source: "built-in NSE calendar",
          holidays: upcomingHolidays(fromDate).slice(0, 200).map(pickHoliday),
        });
      }
    })(),
  ]);
  // Keep the public Desk AI sample to shared, factual market inputs; never copy
  // the endpoint's buyer/seller ideas or any account-specific context.
  const deskMarket = await captureSource(
    () => api.get("/desk-outside", { timeout: 20_000 }),
    pickDeskMarket,
  );
  // This capture runs from the Admin-only settings page: GET /alerts returns
  // the publisher desk tape here, not a member-filtered personal inbox.
  const activity = await captureSource(
    () => api.get("/alerts", { timeout: 12_000 }),
    (data) => ({
      items: Array.isArray(data?.alerts)
        ? data.alerts.slice(0, MAX_FEED_ITEMS).map((item, itemIndex) => ({
            id: item.alert_id || `${item.index || "desk"}-${item.created_at || itemIndex}`,
            index: item.index || "",
            at: item.created_at || "",
            title: item.message || `${item.index || "Shared"} OI alert`,
            detail: [
              item.severity ? `Severity ${item.severity}` : "",
              item.direction || "",
              item.atm != null ? `ATM ${item.atm}` : "",
              item.price != null ? `Spot ${item.price}` : "",
            ].filter(Boolean).join(" · "),
          }))
        : [],
    }),
  );
  const capturedAt = now.toISOString();

  const hasSharedMarketData = Object.values(indices).some(
    (item) => item.oi_change?.current || item.straddle.status === "captured",
  );
  const hasSharedFeedData = [marketIntel, globalMarkets, deskMarket, holidays, activity]
    .some((source) => source.status === "captured");
  if (!hasSharedMarketData && !hasSharedFeedData) {
    throw new Error("No shared market data was available to capture. Check the publisher feeds and try again.");
  }

  return {
    captured_at: capturedAt,
    indices,
    market_intel: marketIntel,
    global_markets: globalMarkets,
    desk_market: deskMarket,
    holidays,
    activity,
  };
}
