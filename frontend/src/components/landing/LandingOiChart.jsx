import React from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const PUT_GREEN = "#16A34A";
const PUT_LIGHT = "#86EFAC";
const CALL_RED = "#DC2626";
const CALL_LIGHT = "#FCA5A5";
const SAMPLE_STRIKE_COUNT = 11;

function formatLakhs(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  if (Math.abs(number) >= 100) return `${(number / 100).toFixed(1)}Cr`;
  return `${number.toFixed(number % 1 === 0 ? 0 : 1)}L`;
}

function formatStrike(value) {
  return Number(value).toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

function chartRows(current, previous, sample) {
  const previousByStrike = new Map((previous?.strikes || []).map((row) => [row.strike, row]));
  const strikes = current?.strikes || [];
  const atm = Number(current?.atm);
  // Keep fictional sample charts readable on the landing preview; captured Admin data stays intact.
  const visibleStrikes = sample && Number.isFinite(atm) && strikes.length > SAMPLE_STRIKE_COUNT
    ? [...strikes]
      .sort((first, second) => Math.abs(Number(first.strike) - atm) - Math.abs(Number(second.strike) - atm))
      .slice(0, SAMPLE_STRIKE_COUNT)
      .sort((first, second) => Number(first.strike) - Number(second.strike))
    : strikes;
  return visibleStrikes.map((row) => {
    const before = previousByStrike.get(row.strike);
    const ceNow = Number(row.ce_oi || 0) / 100_000;
    const peNow = Number(row.pe_oi || 0) / 100_000;
    const cePrev = before ? Number(before.ce_oi || 0) / 100_000 : ceNow;
    const pePrev = before ? Number(before.pe_oi || 0) / 100_000 : peNow;
    return {
      strike: row.strike,
      ce_base: Math.min(ceNow, cePrev),
      ce_up: Math.max(0, ceNow - cePrev),
      ce_down: Math.max(0, cePrev - ceNow),
      pe_base: Math.min(peNow, pePrev),
      pe_up: Math.max(0, peNow - pePrev),
      pe_down: Math.max(0, pePrev - peNow),
    };
  });
}

function LandingOiTooltip({ active, label, payload }) {
  if (!active || !payload?.length) return null;
  const rows = payload.reduce((values, item) => {
    const group = item.dataKey.startsWith("pe_") ? "Put" : "Call";
    const segment = item.dataKey.endsWith("_base") ? "OI" : item.dataKey.endsWith("_up") ? "Increase" : "Decrease";
    values[group] ||= { oi: 0, increase: 0, decrease: 0 };
    values[group][segment.toLowerCase()] += Number(item.value || 0);
    return values;
  }, {});
  return (
    <div className="rounded-md border border-slate-200 bg-white px-2.5 py-2 text-[9px] shadow-lg">
      <div className="mb-1 font-bold text-slate-800">Strike {formatStrike(label)}</div>
      {["Put", "Call"].map((side) => rows[side] && (
        <div key={side} className="grid grid-cols-[auto_auto_auto_auto] gap-x-2 leading-4">
          <span className={side === "Put" ? "font-semibold text-emerald-700" : "font-semibold text-rose-700"}>{side}</span>
          <span>OI {rows[side].oi.toFixed(1)}L</span>
          {rows[side].increase > 0 && <span>+{rows[side].increase.toFixed(1)}L</span>}
          {rows[side].decrease > 0 && <span>−{rows[side].decrease.toFixed(1)}L</span>}
        </div>
      ))}
    </div>
  );
}

function LegendKey({ color, label, pattern = false, outline = false }) {
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap">
      <span
        className="h-2 w-2 rounded-full"
        style={{
          background: outline ? "white" : pattern ? `repeating-linear-gradient(135deg, ${color}, ${color} 2px, white 2px, white 4px)` : color,
          border: outline ? `1px solid ${color}` : undefined,
        }}
      />
      {label}
    </span>
  );
}

export default function LandingOiChart({ current, previous, featureId = "open_interest", sample = false }) {
  const showWindowChange = featureId === "oi_change";
  // Open Interest is a current distribution; only OI Change compares snapshots.
  const rows = chartRows(current, showWindowChange ? previous : null, sample);
  if (!rows.length) return null;
  const atm = Number(current?.atm);
  const spot = Number(current?.price);
  const title = showWindowChange ? "OI Change" : "Open Interest";

  return (
    <div
      className="overflow-hidden rounded-lg border border-slate-200 bg-white"
      data-testid="landing-oi-chart"
      data-strike-count={rows.length}
      data-has-atm={rows.some((row) => row.strike === atm) ? "true" : "false"}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-emerald-100 bg-emerald-50/40 px-2.5 py-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded bg-emerald-600 text-[8px] font-bold text-white">S</span>
          <span className="truncate text-[10px] font-bold text-slate-800">{title}</span>
          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[8px] font-semibold text-slate-600">{showWindowChange ? "15 min" : "Distribution"}</span>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-[8px] font-bold uppercase ${sample ? "bg-amber-100 text-amber-900" : "bg-emerald-100 text-emerald-900"}`}>
          {sample ? "Illustrative sample" : "Admin capture"}
        </span>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-2.5 pt-2 text-[8px] text-slate-500">
        <span className="slz-mono">ATM {Number.isFinite(atm) ? formatStrike(atm) : "—"}{Number.isFinite(spot) ? ` · Spot ${spot.toLocaleString("en-IN", { maximumFractionDigits: 2 })}` : ""}</span>
        <span>{rows.length} strikes · {showWindowChange ? "OI with window change" : "current OI distribution"}</span>
      </div>
      <div className="h-[190px] w-full px-1 pt-1 sm:h-[220px]" data-testid="landing-oi-bars">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 16, right: 8, bottom: 22, left: 4 }} barCategoryGap="18%" barGap={1}>
            <defs>
              <pattern id="landing-pe-stripes" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
                <rect width="6" height="6" fill={PUT_LIGHT} />
                <line x1="0" y1="0" x2="0" y2="6" stroke={PUT_GREEN} strokeWidth="3" />
              </pattern>
              <pattern id="landing-ce-stripes" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
                <rect width="6" height="6" fill={CALL_LIGHT} />
                <line x1="0" y1="0" x2="0" y2="6" stroke={CALL_RED} strokeWidth="3" />
              </pattern>
            </defs>
            <CartesianGrid stroke="#E2E8F0" vertical={false} />
            <XAxis
              dataKey="strike"
              tick={{ fontSize: 7, fill: "#64748B" }}
              axisLine={{ stroke: "#CBD5E1" }}
              tickLine={false}
              angle={-38}
              textAnchor="end"
              height={38}
              interval={rows.length > 18 ? 1 : 0}
              tickFormatter={(value) => `${(Number(value) / 1000).toFixed(1)}k`}
            />
            <YAxis
              tick={{ fontSize: 8, fill: "#64748B" }}
              axisLine={false}
              tickLine={false}
              tickFormatter={formatLakhs}
              width={40}
            />
            <Tooltip content={<LandingOiTooltip />} cursor={{ fill: "rgba(148,163,184,0.12)" }} />
            {Number.isFinite(atm) && (
              <ReferenceLine
                x={atm}
                stroke="#334155"
                strokeDasharray="4 3"
                label={{ value: `ATM ${formatStrike(atm)}`, position: "insideTop", fill: "#334155", fontSize: 8, fontWeight: 700 }}
              />
            )}
            <Bar dataKey="pe_base" stackId="pe" name="Put OI" fill={PUT_GREEN} isAnimationActive={false} />
            {showWindowChange && <Bar dataKey="pe_up" stackId="pe" name="Put increase" fill="url(#landing-pe-stripes)" isAnimationActive={false} />}
            {showWindowChange && <Bar dataKey="pe_down" stackId="pe" name="Put decrease" fill="#fff" stroke={PUT_GREEN} strokeWidth={1} isAnimationActive={false} />}
            <Bar dataKey="ce_base" stackId="ce" name="Call OI" fill={CALL_RED} isAnimationActive={false} />
            {showWindowChange && <Bar dataKey="ce_up" stackId="ce" name="Call increase" fill="url(#landing-ce-stripes)" isAnimationActive={false} />}
            {showWindowChange && <Bar dataKey="ce_down" stackId="ce" name="Call decrease" fill="#fff" stroke={CALL_RED} strokeWidth={1} isAnimationActive={false} />}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1 border-t border-slate-100 px-2 py-1.5 text-[7px] text-slate-600 sm:text-[8px]">
        <LegendKey color={PUT_GREEN} label="Put OI" />
        {showWindowChange && <LegendKey color={PUT_GREEN} label="Increase" pattern />}
        {showWindowChange && <LegendKey color={PUT_GREEN} label="Decrease" outline />}
        <LegendKey color={CALL_RED} label="Call OI" />
        {showWindowChange && <LegendKey color={CALL_RED} label="Increase" pattern />}
        {showWindowChange && <LegendKey color={CALL_RED} label="Decrease" outline />}
      </div>
    </div>
  );
}
