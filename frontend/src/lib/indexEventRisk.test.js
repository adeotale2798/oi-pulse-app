import assert from "node:assert/strict";
import {
  upcomingIndexEvents,
  impactTone,
  eventDisplayName,
  daysText,
  weightageBucket,
  eventHighlightBucket,
  eventContextLabel,
  filterIndexEvents,
} from "./indexEventRisk.js";

const rows = [
  { id: "past", symbol: "TCS", days_remaining: -2, weightage: 4, event_type: "Quarterly Results" },
  { id: "far", symbol: "INFY", days_remaining: 20, weightage: 6, event_type: "Dividend" },
  { id: "soon", symbol: "HDFCBANK", days_remaining: 3, weightage: 12, event_type: "Board Meeting" },
  { id: "today", symbol: "RELIANCE", days_remaining: 0, weightage: 9, event_type: "AGM" },
];

const up = upcomingIndexEvents(rows);
assert.equal(up.map((e) => e.id).join(","), "today,soon,far");
assert.ok(up.every((e) => e.days_remaining >= 0));
assert.equal(impactTone(up), "red");
assert.equal(impactTone(upcomingIndexEvents([{ days_remaining: 10 }])), "blue");
assert.equal(impactTone(upcomingIndexEvents([{ days_remaining: 21 }])), "neutral");
assert.equal(impactTone([]), "neutral");
assert.equal(eventDisplayName({ symbol: "HDFCBANK", company_name: "HDFC Bank" }, "NIFTY"), "HDFCBANK");
assert.equal(eventDisplayName({ symbol: "HDFCBANK", company_name: "HDFC Bank" }, "SENSEX"), "HDFC Bank");
assert.equal(
  eventDisplayName({ symbol: "500180", company_name: "HDFC Bank Ltd", constituents: "HDFC BANK LTD." }, "SENSEX"),
  "HDFC BANK LTD.",
);
assert.equal(
  eventDisplayName({ symbol: "500180", constituents: "HDFC Bank Ltd" }, "SENSEX"),
  "HDFC Bank Ltd",
);
assert.equal(daysText(0), "TODAY");
assert.equal(daysText(1), "TOMORROW");
assert.equal(daysText(5), "in 5d");
assert.equal(weightageBucket(5.1), "dark-red");
assert.equal(weightageBucket(5), "red");
assert.equal(weightageBucket(3), "red");
assert.equal(weightageBucket(2.99), "orange");
assert.equal(weightageBucket(1), "orange");
assert.equal(weightageBucket(1.2), "orange");
assert.equal(weightageBucket(0.99), "yellow");
assert.equal(weightageBucket(0.4), "yellow");
assert.equal(weightageBucket(null), "grey");
assert.equal(eventHighlightBucket({ days_remaining: 7, weightage: 5.1 }), "dark-red");
assert.equal(eventHighlightBucket({ days_remaining: 7, weightage: 5 }), "grey");
assert.equal(eventHighlightBucket({ days_remaining: 8, weightage: 7.45 }), "grey");
assert.equal(eventHighlightBucket({ days_remaining: 3, weightage: 4.9 }), "grey");
assert.equal(
  eventContextLabel({ days_remaining: 0, weightage: 7.45 }),
  "Today · Index weight >5%",
);
assert.equal(
  eventContextLabel({ days_remaining: 1, weightage: 4.24 }),
  "Tomorrow · Index weight 3–5%",
);
assert.equal(
  eventContextLabel({ days_remaining: 5, weightage: 0.98 }),
  "In 5 days · Index weight <1%",
);
assert.equal(
  eventContextLabel({ days_remaining: 3, weightage: null }),
  "In 3 days · Index weight unavailable",
);
assert.deepEqual(
  filterIndexEvents(rows, { withinDays: 7 }).map((event) => event.id),
  ["soon", "today"],
);
assert.deepEqual(
  filterIndexEvents(rows, { eventType: "Dividend" }).map((event) => event.id),
  ["far"],
);
assert.deepEqual(
  filterIndexEvents(rows, { withinDays: 7, eventType: "AGM" }).map((event) => event.id),
  ["today"],
);
console.log("indexEventRisk.test.js ok");
