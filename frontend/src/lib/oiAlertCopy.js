/** OI Change / huge-shift / board-alert lines for toasts and the shift modal. */

export function formatOiDelta(v) {
  if (v == null || Number.isNaN(Number(v))) return "—";
  const n = Number(v);
  const abs = Math.abs(n);
  const sign = n > 0 ? "+" : n < 0 ? "-" : "";
  if (abs >= 1e7) return `${sign}${(abs / 1e7).toFixed(2)}Cr`;
  if (abs >= 1e5) return `${sign}${(abs / 1e5).toFixed(2)}L`;
  if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(1)}K`;
  return `${sign}${Math.round(abs)}`;
}

/** Describe the direction implied by OI changes without recommending a trade. */
export function oiSellerRead(bullish) {
  return bullish
    ? "PE OI building — bullish interpretation"
    : "CE OI building — bearish interpretation";
}

export function oiPressureLine(bullish) {
  return bullish
    ? "Bullish pressure (Put OI building)"
    : "Bearish pressure (Call OI building)";
}

export function writerTapeObservation({ bullish, bearish, side, value } = {}) {
  if (bullish === true) return "PE OI change is stronger than CE OI change.";
  if (bullish === false || bearish === true) return "CE OI change is stronger than PE OI change.";
  const build = Number(value) > 0;
  if (side === "CE") return build ? "CE OI increased." : "CE OI decreased.";
  if (side === "PE") return build ? "PE OI increased." : "PE OI decreased.";
  return "";
}

function adminCandidateLine(side) {
  const label = side === "PE" ? "put-selling" : "call-selling";
  return `Admin-only candidate read: assess ${label} only after confirming price, volatility, liquidity, and defined risk.`;
}

export function oiPressureCopy({ index, bullish, windowLabel, pe, ce, isAdmin = false }) {
  const tilt = bullish ? "Puts adding — bullish" : "Calls adding — bearish";
  const lines = [
    oiSellerRead(bullish),
    `${oiPressureLine(bullish)} in last ${windowLabel}`,
  ];
  if (pe != null && ce != null) {
    lines.push(`PE ${formatOiDelta(pe)} · CE ${formatOiDelta(ce)}`);
  }
  const observation = writerTapeObservation({ bullish });
  if (observation) lines.push(observation);
  if (isAdmin) lines.push(adminCandidateLine(bullish ? "PE" : "CE"));
  return {
    title: `${index} · ${tilt}`,
    description: lines.join("\n"),
  };
}

export function oiBoardAlertCopy({ index, direction, windowLabel, strikes, pe, ce, isAdmin = false }) {
  const dir = direction || "OI reversal spike";
  const win = windowLabel || "15 mins";
  let peSum = pe;
  let ceSum = ce;
  if ((peSum == null || ceSum == null) && Array.isArray(strikes) && strikes.length) {
    peSum = strikes.reduce((s, x) => s + Number(x.pe_abs || 0), 0);
    ceSum = strikes.reduce((s, x) => s + Number(x.ce_abs || 0), 0);
  }
  const bits = [];
  if (peSum != null && ceSum != null) {
    bits.push(`PE ${formatOiDelta(peSum)} · CE ${formatOiDelta(ceSum)}`);
  }
  const bullish = /bullish/i.test(dir);
  if (/put oi building|bullish/i.test(dir)) bits.unshift(oiSellerRead(true));
  else if (/call oi building|bearish/i.test(dir)) bits.unshift(oiSellerRead(false));
  const observation = /put oi building|bullish/i.test(dir)
    ? writerTapeObservation({ bullish: true })
    : /call oi building|bearish/i.test(dir)
      ? writerTapeObservation({ bullish: false })
      : "";
  if (observation) bits.push(observation);
  if (isAdmin && (bullish || /call oi building|bearish/i.test(dir))) {
    bits.push(adminCandidateLine(bullish ? "PE" : "CE"));
  }
  return {
    title: `${index}: ${dir} in last ${win}`,
    description: bits.join(" · "),
  };
}

export function oiPctCopy({ index, side, pct, windowLabel, pe, ce, isAdmin = false }) {
  const name = side === "CE" ? "Calls" : "Puts";
  const moved = pct >= 0 ? "up" : "down";
  const lines = [`Last ${windowLabel}`];
  if (pe != null && ce != null) {
    lines.push(`PE ${formatOiDelta(pe)} · CE ${formatOiDelta(ce)}`);
  }
  if (isAdmin && Number(pct) > 0) lines.push(adminCandidateLine(side));
  return {
    title: `${index} · ${name} ${moved} ${Math.abs(Number(pct) || 0).toFixed(1)}%`,
    description: lines.join(" · "),
  };
}

export function hugeShiftCopy(side, value, isAdmin = false) {
  const build = Number(value) > 0;
  const candidateSide = side === "CE" ? "CE" : "PE";
  const addAdminRead = (copy) => isAdmin && build
    ? {
      ...copy,
      read: `${copy.read} Admin-only candidate read: assess ${candidateSide} selling only after confirming price, volatility, liquidity, and defined risk.`,
    }
    : copy;
  if (side === "CE" && build) {
    return addAdminRead({
      headline: "Calls added near ATM",
      read: "Call sellers stepping in — resistance, bearish tilt.",
      tone: "rose",
    });
  }
  if (side === "CE" && !build) {
    return addAdminRead({
      headline: "Calls cut near ATM",
      read: "Call sellers leaving — resistance fading, bullish tilt.",
      tone: "emerald",
    });
  }
  if (side === "PE" && build) {
    return addAdminRead({
      headline: "Puts added near ATM",
      read: "Put sellers stepping in — support, bullish tilt.",
      tone: "emerald",
    });
  }
  return addAdminRead({
    headline: "Puts cut near ATM",
    read: "Put sellers leaving — support fading, bearish tilt.",
    tone: "rose",
  });
}

export function hugeShiftToastCopy({ index, side, value, window, isAdmin = false }) {
  const { headline, read } = hugeShiftCopy(side, value, isAdmin);
  const observation = writerTapeObservation({ side, value });
  return {
    title: `${index} · ${headline}`,
    description: [
      window != null ? `${window} min window` : "",
      observation,
      isAdmin && Number(value) > 0 ? read : "",
    ].filter(Boolean).join(" · "),
  };
}
