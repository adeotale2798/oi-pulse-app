import assert from "node:assert/strict";
import {
  pickIndexLtp,
  indexDayMove,
  shouldReplaceSpotQuote,
} from "./indexQuotes.js";

assert.equal(
  pickIndexLtp({ idx: "GOLD", live: 112578, tickerLtp: 112000, current: { index: "NIFTY", price: 24366 } }),
  112578,
);
assert.equal(
  pickIndexLtp({ idx: "GOLD", live: null, tickerLtp: 112578, current: { index: "NIFTY", price: 24366 } }),
  112578,
);
assert.equal(
  pickIndexLtp({ idx: "GOLD", live: null, tickerLtp: null, current: { index: "NIFTY", price: 24366 } }),
  null,
);
assert.equal(
  pickIndexLtp({ idx: "GOLD", live: null, tickerLtp: null, current: { index: "GOLD", price: 112578 } }),
  112578,
);
assert.equal(
  pickIndexLtp({ idx: "SENSEX", live: null, tickerLtp: 0, cachedPrice: 81150, current: { index: "NIFTY", price: 24366 } }),
  81150,
);
assert.equal(
  shouldReplaceSpotQuote(
    { price: 100, asOf: "2026-10-27T09:15:02Z" },
    { price: 101, asOf: "2026-10-27T09:15:01Z" },
  ),
  false,
  "stale REST/WebSocket quote cannot replace a newer quote",
);
assert.equal(
  shouldReplaceSpotQuote(
    { price: 100, asOf: "2026-10-27T09:15:01Z" },
    { price: 101, asOf: "2026-10-27T09:15:02Z" },
  ),
  true,
  "fresh REST quote replaces a disconnected WebSocket value",
);
assert.equal(
  shouldReplaceSpotQuote({ price: 100, asOf: "2026-10-27T09:15:01Z" }, { price: 0, asOf: "2026-10-27T09:15:03Z" }),
  false,
  "invalid quote is never accepted",
);
{
  const m = indexDayMove({ price: 77218, ticker: { prev_close: 77369, change: -10 } });
  assert.equal(Math.round(m.pts), -151);
  assert.ok(m.pct < 0);
}
{
  const m = indexDayMove({ price: null, ticker: { change: -151, change_pct: -0.2 } });
  assert.equal(m.pts, -151);
  assert.equal(m.pct, -0.2);
}

console.log("indexQuotes.test.js: ok");
