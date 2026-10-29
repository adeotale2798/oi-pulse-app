import { HEATMAP_IDS, matchSymbolPrefix } from "./universe.js";
import { bookedPct, madeAfterCharges } from "./journalPct.js";

function isTraded(doc) {
  if (!doc) return false;
  if ((doc.exited_count || 0) > 0) return true;
  if ((doc.partial_count || 0) > 0) return true;
  if (Math.abs(Number(doc.booked_pnl) || 0) > 0.009) return true;
  if (Math.abs(Number(doc.pnl_exited) || 0) > 0.009) return true;
  if ((doc.legs || []).some((l) => l && (l.exited || l.partial || Math.abs(Number(l.realised) || 0) > 0.009))) return true;
  return false;
}

function cellPnl(doc) {
  if (!doc) return 0;
  if (doc.booked_pnl != null) return Number(doc.booked_pnl) || 0;
  if (doc.pnl_exited != null) return Number(doc.pnl_exited) || 0;
  if (doc.display_pnl != null) return Number(doc.display_pnl) || 0;
  return 0;
}

export function heatmapIndexFromLeg(leg) {
  const raw = String(leg?.index || "").trim().toUpperCase();
  if (raw && raw !== "OTHER" && raw !== "UNKNOWN") return raw;
  const ts = String(leg?.tradingsymbol || leg?.display_name || "").toUpperCase().replace(/\s+/g, "");
  const fromTs = matchSymbolPrefix(ts)
    || ["MIDCPNIFTY", "FINNIFTY", "BANKEX", "NATGASMINI"].find((prefix) => ts.startsWith(prefix));
  if (fromTs) return fromTs;
  const stockOption = ts.match(/^(.+?)(\d{2}[A-Z]{3}\d{2,6})(CE|PE)$/);
  if (stockOption) return stockOption[1];
  return "OTHER";
}

function emptyPnl(indices = HEATMAP_IDS) {
  return Object.fromEntries([...new Set([...HEATMAP_IDS, ...indices])].map((idx) => [idx, 0]));
}

function bookedIndexPnl(doc) {
  const acc = emptyPnl();
  let other = 0;
  const legs = (doc?.legs || []).filter(
    (l) => l && (l.exited || l.partial || Math.abs(Number(l.realised) || 0) > 0.009),
  );
  if (legs.length) {
    for (const leg of legs) {
      const key = heatmapIndexFromLeg(leg);
      let val = Number(leg.realised);
      if (!Number.isFinite(val) || Math.abs(val) < 1e-9) val = Number(leg.pnl) || 0;
      if (key === "OTHER") other += val;
      else acc[key] = (acc[key] || 0) + val;
    }
  } else {
    const ip = doc?.booked_index_pnl || {};
    for (const [k, v] of Object.entries(ip)) {
      const key = String(k).toUpperCase();
      if (key === "OTHER" || key === "UNKNOWN") other += Number(v) || 0;
      else acc[key] = (acc[key] || 0) + (Number(v) || 0);
    }
  }
  const attributed = Object.values(acc).reduce((sum, value) => sum + value, 0) + other;
  const gap = cellPnl(doc) - attributed;
  if (Math.abs(gap) > 0.5) other += gap;
  return { ...acc, OTHER: other };
}

function emptyHeat(year, indices = HEATMAP_IDS) {
  const rows = [...new Set(indices.filter((idx) => idx !== "OTHER"))];
  const by_index = Object.fromEntries(rows.map((idx) => [idx, Array(12).fill(0)]));
  return {
    year,
    indices: rows,
    by_index,
    other: Array(12).fill(0),
    month_nets: Array(12).fill(0),
    months: Array.from({ length: 12 }, (_, i) => ({
      month: i + 1,
      net_pnl: 0,
      trading_days: 0,
      by_index: emptyPnl(rows),
      other: 0,
    })),
  };
}

function cloneHeat(base, year) {
  const baseRows = Array.isArray(base?.indices)
    ? base.indices.filter((idx) => idx && idx !== "OTHER")
    : HEATMAP_IDS;
  const allRows = [...new Set([...baseRows, ...Object.keys(base?.by_index || {}).filter((idx) => idx !== "OTHER")])];
  const heat = emptyHeat(year, allRows);
  if (!base) return heat;
  if (base.by_index) {
    for (const idx of heat.indices) {
      heat.by_index[idx] = (base.by_index[idx] || Array(12).fill(0)).slice();
    }
  }
  if (base.month_nets) {
    for (let i = 0; i < 12; i += 1) heat.month_nets[i] = Number(base.month_nets[i]) || 0;
  }
  if (base.other) {
    for (let i = 0; i < 12; i += 1) heat.other[i] = Number(base.other[i]) || 0;
  }
  if (base.months) {
    for (let i = 0; i < 12; i += 1) {
      const m = base.months[i] || {};
      const byIdx = emptyPnl(heat.indices);
      for (const idx of heat.indices) {
        const monthValue = m.by_index?.[idx];
        byIdx[idx] = monthValue != null
          ? Number(monthValue) || 0
          : heat.by_index[idx]?.[i] || 0;
      }
      heat.months[i] = {
        month: i + 1,
        net_pnl: m.net_pnl != null ? Number(m.net_pnl) || 0 : heat.month_nets[i],
        trading_days: Number(m.trading_days) || 0,
        by_index: byIdx,
        other: m.other != null ? Number(m.other) || 0 : heat.other[i],
        funds_base: m.funds_base ?? null,
        booked_pct: m.booked_pct ?? null,
      };
    }
  }
  return heat;
}

/** If the open month calendar has booked days, stamp that month onto the year grid. */
export function overlayMonthOnYearHeat(yearHeat, monthPayload, year, month) {
  const heat = cloneHeat(yearHeat, year);
  const days = monthPayload?.days || [];
  if (!days.length) return heat;
  if (Number(monthPayload.year) !== Number(year) && monthPayload.year != null) return heat;
  if (Number(monthPayload.month) !== Number(month) && monthPayload.month != null) return heat;
  const mi = month - 1;
  if (mi < 0 || mi > 11) return heat;
  let net = 0;
  let made = 0;
  let tradedDays = 0;
  const idxAcc = emptyPnl(heat.indices);
  let other = 0;
  days.forEach((d) => {
    for (const leg of d?.legs || []) {
      const idx = heatmapIndexFromLeg(leg);
      if (idx === "OTHER" || heat.indices.includes(idx)) continue;
      heat.indices.push(idx);
      heat.by_index[idx] = Array(12).fill(0);
      idxAcc[idx] = 0;
    }
    if (!isTraded(d)) return;
    net += cellPnl(d);
    made += madeAfterCharges(d);
    tradedDays += 1;
    const ip = bookedIndexPnl(d);
    for (const [k, value] of Object.entries(ip)) {
      if (k === "OTHER") continue;
      if (!heat.indices.includes(k) && (!HEATMAP_IDS.includes(k) || Math.abs(Number(value) || 0) > 0.009)) {
        heat.indices.push(k);
        heat.by_index[k] = Array(12).fill(0);
      }
      idxAcc[k] = (idxAcc[k] || 0) + (Number(value) || 0);
    }
    other += Number(ip.OTHER) || 0;
  });
  if (!tradedDays) return heat;
  let fundsBase = null;
  const ordered = [...days].sort((a, b) => String(a?.date || "").localeCompare(String(b?.date || "")));
  for (const d of ordered) {
    const b = Number(d?.funds_base);
    if (Number.isFinite(b) && b >= 1) {
      fundsBase = b;
      break;
    }
  }
  heat.month_nets[mi] = net;
  heat.other[mi] = other;
  heat.months[mi] = {
    month,
    net_pnl: net,
    trading_days: tradedDays,
    by_index: { ...idxAcc },
    other,
    funds_base: fundsBase,
    booked_pct: bookedPct(made, fundsBase),
  };
  for (const k of heat.indices) heat.by_index[k][mi] = idxAcc[k] || 0;
  return heat;
}
