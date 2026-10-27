import assert from "node:assert/strict";
import { configureMarketHours } from "./marketTimes.js";
import {
  straddleLiveRefreshActive,
  straddleRefreshLabel,
  straddleWsDataFresh,
} from "./straddleRefresh.js";

configureMarketHours("09:15", "15:40");

const liveThu = new Date("2026-09-17T05:45:00.000Z"); // 11:15 IST Thursday
const postThu = new Date("2026-09-17T10:20:00.000Z"); // 15:50 IST Thursday
const weekend = new Date("2026-09-19T05:45:00.000Z"); // Saturday
const holiday = new Date("2026-09-14T05:45:00.000Z"); // Ganesh Chaturthi 2026
const historicalDate = "2026-09-16";

assert.equal(straddleLiveRefreshActive(liveThu, "2026-09-17"), true, "live market");
assert.equal(straddleLiveRefreshActive(postThu, "2026-09-17"), false, "post-market");
assert.equal(straddleLiveRefreshActive(weekend, "2026-09-19"), false, "weekend");
assert.equal(straddleLiveRefreshActive(holiday, "2026-09-14"), false, "holiday");
assert.equal(straddleLiveRefreshActive(liveThu, historicalDate), false, "historical date");
assert.equal(straddleRefreshLabel(true, 4, 15000), "next (11s)");
assert.equal(straddleRefreshLabel(false, 4, 15000), null, "no countdown when closed");
assert.equal(straddleWsDataFresh(0, 1000, 15000), false, "open socket without data");
assert.equal(straddleWsDataFresh(1000, 30000, 15000), true, "recent socket data");
assert.equal(straddleWsDataFresh(1000, 31001, 15000), false, "stale socket data");
assert.equal(straddleWsDataFresh(2000, 1000, 15000), false, "future socket timestamp");
console.log("straddleRefresh.test.js ok");
