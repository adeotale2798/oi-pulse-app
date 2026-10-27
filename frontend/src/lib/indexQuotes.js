/** Per-index LTP. Never reuse another index's OI snapshot price. */
export function pickIndexLtp({ idx, live, tickerLtp, current, cachedPrice } = {}) {
  const liveN = live == null ? null : Number(live);
  if (liveN != null && Number.isFinite(liveN) && liveN !== 0) return liveN;
  const tickN = tickerLtp == null ? null : Number(tickerLtp);
  if (tickN != null && Number.isFinite(tickN) && tickN !== 0) return tickN;
  const cacheN = cachedPrice == null ? null : Number(cachedPrice);
  if (cacheN != null && Number.isFinite(cacheN) && cacheN !== 0) return cacheN;
  const curIdx = String(current?.index || "").toUpperCase();
  const want = String(idx || "").toUpperCase();
  if (want && curIdx === want) {
    const c = Number(current?.price);
    if (Number.isFinite(c) && c !== 0) return c;
  }
  return null;
}

/** Keep the freshest valid quote when WebSocket and REST feeds overlap. */
export function shouldReplaceSpotQuote(previous, incoming) {
  const price = Number(incoming?.price);
  if (!Number.isFinite(price) || price <= 0) return false;
  if (!previous) return true;

  const previousAt = Date.parse(previous.asOf || "");
  const incomingAt = Date.parse(incoming.asOf || "");
  if (Number.isFinite(incomingAt) && Number.isFinite(previousAt)) {
    return incomingAt >= previousAt;
  }
  if (Number.isFinite(incomingAt)) return true;
  if (Number.isFinite(previousAt)) return false;
  return true;
}

/** Day move vs prev close for inactive index chips (do not wait for that tab). */
export function indexDayMove({ price, ticker } = {}) {
  const prev = Number(ticker?.prev_close || ticker?.day_open) || 0;
  const px = price == null ? null : Number(price);
  if (px != null && Number.isFinite(px) && prev) {
    const pts = px - prev;
    return { pts, pct: (pts / prev) * 100 };
  }
  const pts = ticker?.change == null ? null : Number(ticker.change);
  const pct = ticker?.change_pct == null ? null : Number(ticker.change_pct);
  return {
    pts: Number.isFinite(pts) ? pts : null,
    pct: Number.isFinite(pct) ? pct : null,
  };
}
