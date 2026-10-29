import assert from "node:assert/strict";
import {
  clampPositionsBookPollMs,
  positionsBookPollDelayMs,
  shouldLivePollPositionsBook,
  shouldPollPositionsBook,
} from "./positionsBookPoll.js";

function atIst(year, month, day, hour, minute) {
  return new Date(Date.UTC(year, month - 1, day, hour, minute) - 330 * 60 * 1000);
}

function openLiveCount(payload) {
  const rows = payload?.positions;
  if (!Array.isArray(rows)) return 0;
  return rows.filter((r) => !r.exited && Number(r.quantity) !== 0).length;
}

assert.equal(openLiveCount(null), 0);
assert.equal(openLiveCount({}), 0);
assert.equal(
  openLiveCount({
    positions: [
      { quantity: 50, exited: false },
      { quantity: 0, exited: true },
      { quantity: -25, exited: false },
    ],
  }),
  2,
);
assert.equal(openLiveCount({ positions: [{ quantity: 10, exited: true }] }), 0);

const goldBook = {
  positions: [{ exchange: "MCX", session_group: "mcx_non_agri", quantity: -2, exited: false }],
};
const cottonBook = {
  positions: [{ exchange: "MCX", session_group: "mcx_select_agri", quantity: -2, exited: false }],
};
assert.equal(shouldPollPositionsBook(atIst(2026, 10, 29, 15, 46)), true);
assert.equal(shouldPollPositionsBook(atIst(2026, 10, 29, 22, 30)), true);
assert.equal(shouldPollPositionsBook(atIst(2026, 10, 29, 23, 35)), false);
assert.equal(shouldPollPositionsBook(atIst(2026, 11, 6, 23, 59)), true);
assert.equal(shouldPollPositionsBook(atIst(2026, 11, 7, 0, 0)), false);
assert.equal(shouldPollPositionsBook(atIst(2026, 10, 31, 20, 0)), false);
assert.equal(
  shouldPollPositionsBook(atIst(2026, 10, 29, 22, 30), { kite_connected: false }),
  false,
);
assert.equal(shouldLivePollPositionsBook(atIst(2026, 10, 29, 22, 30), goldBook), true);
assert.equal(shouldLivePollPositionsBook(atIst(2026, 10, 29, 22, 30), cottonBook), false);
assert.equal(
  shouldLivePollPositionsBook(atIst(2026, 10, 29, 22, 30), {
    positions: [{ ...goldBook.positions[0], exited: true, quantity: 0 }],
  }),
  false,
);
assert.equal(shouldLivePollPositionsBook(atIst(2026, 10, 29, 10, 0), null), true);
assert.equal(shouldLivePollPositionsBook(atIst(2026, 10, 29, 16, 0), null), false);

assert.equal(clampPositionsBookPollMs(15_000), 15_000);
assert.equal(clampPositionsBookPollMs(2000), 2000);
assert.equal(clampPositionsBookPollMs(1000), 1000);
assert.equal(clampPositionsBookPollMs(0), 2000);
assert.equal(clampPositionsBookPollMs(9999999), 3_600_000);
assert.equal(
  positionsBookPollDelayMs({
    hasPayload: true,
    sessionOpen: true,
    pollMs: 2000,
    requestStartedAt: 10_000,
    now: 11_500,
  }),
  500,
);
assert.equal(
  positionsBookPollDelayMs({
    hasPayload: true,
    sessionOpen: true,
    pollMs: 1000,
    requestStartedAt: 10_000,
    now: 11_500,
  }),
  0,
);
assert.equal(
  positionsBookPollDelayMs({
    hasPayload: false,
    sessionOpen: false,
    pollMs: 2000,
    requestStartedAt: 10_000,
    now: 11_500,
  }),
  1500,
);

console.log("positionsBookPoll.test.js ok");
