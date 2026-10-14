import React, { useState } from "react";
import LandingOiChart from "@/components/landing/LandingOiChart";
import { makeSampleOi } from "@/components/landing/planPreviewSamples";

function fmt(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString("en-IN", { maximumFractionDigits: 2 }) : "—";
}

function StatCards({ snap }) {
  const sample = makeSampleOi("NIFTY");
  const spot = snap?.indices?.NIFTY?.price ?? sample.current.price;
  const totalOi = (field) => sample.current.strikes.reduce((total, row) => total + Number(row[field] || 0), 0);
  const cards = [
    ["ATM", (Math.round(spot / 50) * 50).toLocaleString("en-IN"), "text-slate-800", null],
    ["PCR", (snap?.pcr ?? 1.08).toFixed(2), "text-slate-800", null],
    ["CALL OI", `${(totalOi("ce_oi") / 10_000_000).toFixed(2)} Cr`, "text-rose-600", null],
    ["PUT OI", `${(totalOi("pe_oi") / 10_000_000).toFixed(2)} Cr`, "text-emerald-600", null],
    ["EXPIRY", sample.current.expiry, "text-slate-800", sample.current.expiry_type],
  ];
  return (
    <div className="mt-2 grid grid-cols-5 gap-1.5">
      {cards.map(([t, v, c, detail]) => (
        <div key={t} className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5">
          <div className="text-[8px] font-semibold uppercase tracking-wide text-slate-400">{t}</div>
          <div className={`whitespace-nowrap text-[10px] font-bold ${c}`}>{v}</div>
          {detail && <div className="text-[8px] font-medium text-slate-500">{detail}</div>}
        </div>
      ))}
    </div>
  );
}

function StraddlePreview() {
  const premiums = [438, 426, 432, 416, 421, 408, 413, 397, 405, 392, 399, 384, 391, 376, 382, 365, 373, 358, 366, 349, 357, 342, 350, 336];
  const min = Math.min(...premiums) - 10;
  const max = Math.max(...premiums) + 10;
  const points = premiums.map((premium, index) => {
    const x = 34 + (index / (premiums.length - 1)) * 450;
    const y = 12 + ((max - premium) / (max - min)) * 118;
    return `${x},${y}`;
  }).join(" ");
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-3" data-testid="landing-straddle-preview">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-[11px] font-bold text-slate-800">NIFTY · ATM straddle premium</h3>
          <p className="mt-0.5 text-[9px] text-slate-500">Illustrative session path · not live</p>
        </div>
        <span className="rounded-full bg-amber-100 px-2 py-1 text-[8px] font-bold uppercase tracking-wide text-amber-900">Sample preview</span>
      </div>
      <div className="mt-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <div className="slz-mono text-2xl font-black leading-none text-slate-900">₹336.00</div>
          <div className="mt-1 text-[9px] font-semibold text-emerald-700">−23.3% from session open</div>
        </div>
        <div className="grid grid-cols-2 gap-2 text-right text-[9px]">
          <div><div className="uppercase tracking-wide text-slate-400">ATM</div><div className="slz-mono font-bold text-slate-700">25,800</div></div>
          <div>
            <div className="uppercase tracking-wide text-slate-400">Expiry</div>
            <div className="font-bold text-slate-700">28 Sep</div>
            <div className="text-slate-500">Monthly</div>
          </div>
        </div>
      </div>
      <svg className="mt-3 block h-36 w-full" viewBox="0 0 500 160" role="img" aria-label="Illustrative intraday ATM straddle premium line chart">
        {[30, 70, 110, 150].map((y) => <line key={y} x1="34" y1={y} x2="484" y2={y} stroke="#e2e8f0" strokeWidth="1" />)}
        <text x="2" y="34" fill="#94a3b8" fontSize="9">₹440</text>
        <text x="2" y="74" fill="#94a3b8" fontSize="9">₹400</text>
        <text x="2" y="114" fill="#94a3b8" fontSize="9">₹360</text>
        <polyline points={points} fill="none" stroke="#059669" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="484" cy={12 + ((max - premiums[premiums.length - 1]) / (max - min)) * 118} r="4" fill="#059669" />
        <text x="34" y="158" fill="#64748b" fontSize="9">09:20</text>
        <text x="245" y="158" fill="#64748b" fontSize="9" textAnchor="middle">11:30</text>
        <text x="484" y="158" fill="#64748b" fontSize="9" textAnchor="end">15:20</text>
      </svg>
    </section>
  );
}

const POS = [
  ["SENSEX 69500 PE", "PUT", 340, 0.85, 0.70, -238],
  ["SENSEX 73500 PE", "PUT", 280, 9.94, 5.75, 1174],
  ["SENSEX 75800 CE", "CALL", 340, 14.15, 6.30, 2669],
  ["SENSEX 76000 CE", "CALL", 220, 9.48, 4.35, 1129],
  ["SENSEX 78600 CE", "CALL", 200, 0.90, 1.10, 40],
  ["SENSEX 79400 CE", "CALL", 240, 0.83, 0.65, -156],
];

function Positions({ snap }) {
  const drift = Math.round((snap?.pressure ?? 50) - 50) * 3;
  const total = POS.reduce((a, p) => a + p[5], 0) + drift;
  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
        <span className="text-[11px] font-semibold text-slate-700">Your open positions · example</span>
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[8px] font-bold uppercase text-amber-900">Fictional sample</span>
        <span className={`slz-mono text-[11px] font-bold ${total >= 0 ? "text-emerald-600" : "text-rose-600"}`}>P&amp;L {total >= 0 ? "+" : ""}₹{Math.abs(total).toLocaleString("en-IN")}</span>
      </div>
      <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-2 px-3 py-1 text-[8px] font-semibold uppercase text-slate-400">
        <span>Instrument</span><span className="text-right">Avg</span><span className="text-right">LTP</span><span className="text-right">P&amp;L</span>
      </div>
      {POS.map((p, i) => {
        const pnl = p[5] + (i % 2 === 0 ? drift : -drift);
        return (
          <div key={p[0]} className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-x-2 border-t border-slate-50 px-3 py-1.5">
            <div className="flex items-center gap-1.5 truncate">
              <span className={`rounded px-1 py-0.5 text-[8px] font-bold ${p[1] === "PUT" ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"}`}>{p[1]}</span>
              <span className="truncate text-[10px] text-slate-700">{p[0]}</span>
              <span className="slz-mono text-[8px] text-slate-400">×{p[2]}</span>
            </div>
            <span className="slz-mono text-right text-[10px] text-slate-500">{p[3].toFixed(2)}</span>
            <span className="slz-mono text-right text-[10px] text-slate-700">{p[4].toFixed(2)}</span>
            <span className={`slz-mono text-right text-[10px] font-bold ${pnl >= 0 ? "text-emerald-600" : "text-rose-600"}`}>{pnl >= 0 ? "+" : ""}{pnl}</span>
          </div>
        );
      })}
    </div>
  );
}

function IndexTiles({ snap }) {
  const items = [["NIFTY", snap?.indices?.NIFTY, "#16a34a"], ["BANKNIFTY", snap?.indices?.BANKNIFTY, "#4f46e5"], ["SENSEX", snap?.indices?.SENSEX, "#f59e0b"]];
  return (
    <div className="grid grid-cols-3 gap-2">
      {items.map(([label, d, c]) => {
        const up = (d?.changePct ?? 0) >= 0;
        return (
          <div key={label} className="rounded-lg border border-slate-200 bg-white p-2.5">
            <div className="text-[10px] font-semibold text-slate-500">{label}</div>
            <div className="slz-mono text-sm font-bold text-slate-900">{fmt(d?.price)}</div>
            <div className={`slz-mono text-[10px] font-semibold ${up ? "text-emerald-600" : "text-rose-600"}`}>{up ? "▲" : "▼"} {Math.abs(d?.changePct ?? 0).toFixed(2)}%</div>
            <div className="mt-1.5 h-1 rounded-full" style={{ background: c }} />
          </div>
        );
      })}
    </div>
  );
}

function Pressure({ current, previous }) {
  const strikes = current?.strikes || [];
  const callOi = strikes.reduce((sum, row) => sum + Number(row.ce_oi || 0), 0);
  const putOi = strikes.reduce((sum, row) => sum + Number(row.pe_oi || 0), 0);
  const previousStrikes = previous?.strikes || [];
  // Mirror the desk's centered session-bias visual using fictional preview snapshots only.
  const callDelta = strikes.reduce(
    (sum, row, index) => sum + Number(row.ce_oi || 0) - Number(previousStrikes[index]?.ce_oi || 0),
    0,
  );
  const putDelta = strikes.reduce(
    (sum, row, index) => sum + Number(row.pe_oi || 0) - Number(previousStrikes[index]?.pe_oi || 0),
    0,
  );
  const deltaTotal = Math.abs(callDelta) + Math.abs(putDelta);
  const ratio = deltaTotal ? Math.max(-1, Math.min(1, (putDelta - callDelta) / deltaTotal)) : 0;
  const isBullish = ratio >= 0;
  const strength = Math.round(Math.abs(ratio) * 100);
  const peak = (field) => strikes.reduce((best, row) => (
    !best || Number(row[field] || 0) > Number(best[field] || 0) ? row : best
  ), null);
  const callPeak = peak("ce_oi");
  const putPeak = peak("pe_oi");
  const inLakhs = (value) => `${(value / 100_000).toFixed(1)}L`;
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3" data-testid="landing-strike-pressure">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Strike Pressure</div>
          <div className="mt-1 text-[9px] text-slate-500">Session OI build · pressure shown around the midpoint</div>
        </div>
        <span className="rounded-full bg-amber-100 px-2 py-1 text-[8px] font-bold uppercase text-amber-900">Illustrative sample</span>
      </div>
      <div
        className="mt-2 overflow-hidden rounded-md border border-slate-200 bg-white"
        data-testid="landing-strike-pressure-meter"
        role="meter"
        aria-label={`${isBullish ? "Put writers leading OI" : "Call writers leading OI"}, illustrative pressure`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={strength}
      >
        <div className="flex min-w-0 items-center gap-1.5 px-2 py-1.5">
          <span className={`shrink-0 rounded-sm px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wide ${isBullish ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800"}`}>
            {isBullish ? "Bullish" : "Bearish"}
          </span>
          <p className="min-w-0 truncate text-[9px] text-slate-700">
            {isBullish ? "Put writers leading OI" : "Call writers leading OI"}
            <span className="font-mono text-slate-400"> · 9:15 → close</span>
          </p>
          <span className={`ml-auto shrink-0 font-mono text-[10px] font-bold ${isBullish ? "text-emerald-700" : "text-rose-700"}`}>
            {isBullish ? "+" : "−"}{strength}%
          </span>
        </div>
        <div className="relative h-1.5 bg-slate-100" aria-hidden="true">
          <div className="absolute left-1/2 top-0 h-full w-px bg-slate-300" />
          <div
            className={`absolute top-0 h-full ${isBullish ? "bg-emerald-600" : "bg-rose-600"}`}
            style={{
              left: "50%",
              width: `${strength / 2}%`,
              transform: isBullish ? "none" : "translateX(-100%)",
            }}
          />
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {[
          { label: "Call-side OI", total: callOi, peak: callPeak, field: "ce_oi", tone: "text-rose-700" },
          { label: "Put-side OI", total: putOi, peak: putPeak, field: "pe_oi", tone: "text-emerald-700" },
        ].map(({ label, total, peak: peakRow, field, tone }) => (
          <div key={label} className="rounded-md border border-slate-200 bg-slate-50 p-2">
            <div className="text-[8px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
            <div className={`mt-1 text-sm font-bold ${tone}`}>{inLakhs(total)}</div>
            <div className="mt-1 text-[9px] leading-4 text-slate-600">
              Largest listed strike: {peakRow?.strike?.toLocaleString("en-IN") || "—"} · {peakRow ? inLakhs(Number(peakRow[field] || 0)) : "—"}
            </div>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[9px] text-slate-400">Fictional session sample · not live market data or a trade signal</p>
    </div>
  );
}

const GLOBAL_MARKET_SAMPLE = [
  ["Dr Reddy's Laboratories", "DRREDDY", "RDY", "$12.79", "+0.27%", "163.9K"],
  ["HDFC Bank", "HDFCBANK", "HDB", "$22.80", "+1.08%", "514.6K"],
  ["ICICI Bank", "ICICIBANK", "IBN", "$28.50", "+1.62%", "334.4K"],
  ["Infosys", "INFY", "INFY", "$11.51", "+6.23%", "2.51M"],
  ["Sify Technologies", "SIFY", "SIFY", "$12.59", "−1.33%", "874K"],
  ["Wipro", "WIPRO", "WIT", "$1.805", "+6.18%", "784.2K"],
];

function GlobalMarkets() {
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white" data-testid="global-markets-preview">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50 px-3 py-2">
        <div>
          <div className="text-[8px] font-bold uppercase tracking-[0.16em] text-slate-400">Unified market monitor</div>
          <div className="text-[11px] font-semibold text-slate-800">Global Markets · ADR Monitor</div>
        </div>
        <span className="rounded-full bg-amber-100 px-2 py-1 text-[8px] font-bold uppercase text-amber-900">Fictional sample data</span>
      </div>
      <div className="grid grid-cols-2 gap-1.5 p-2 sm:grid-cols-4">
        {[["Coverage", "6 ADRs"], ["Gainers", "4"], ["Losers", "2"], ["US market", "Closed"]].map(([label, value]) => (
          <div key={label} className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5">
            <div className="text-[7px] font-bold uppercase tracking-wide text-slate-400">{label}</div>
            <div className="mt-0.5 text-[10px] font-semibold text-slate-800">{value}</div>
          </div>
        ))}
      </div>
      <div className="overflow-x-auto px-2 pb-2">
        <table className="w-full min-w-[34rem] text-[8px]">
          <thead className="bg-slate-50 text-[7px] uppercase tracking-wide text-slate-500">
            <tr>
              {["Company", "Indian symbol", "ADR", "Last", "Change", "Volume"].map((label) => (
                <th key={label} className="px-2 py-1.5 text-left">{label}</th>
              ))}
            </tr>
          </thead>
          <tbody>{GLOBAL_MARKET_SAMPLE.map(([company, symbol, adr, last, change, volume]) => (
            <tr key={symbol} className="border-t border-slate-100">
              <td className="px-2 py-1.5 font-semibold text-slate-800">{company}</td>
              <td className="px-2 py-1.5 text-slate-600">{symbol}</td>
              <td className="px-2 py-1.5 text-slate-600">{adr}</td>
              <td className="px-2 py-1.5 font-mono text-slate-700">{last}</td>
              <td className={`px-2 py-1.5 font-mono font-semibold ${change.startsWith("+") ? "text-emerald-700" : "text-rose-700"}`}>{change}</td>
              <td className="px-2 py-1.5 font-mono text-slate-500">{volume}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  );
}

const DESK_MARKET_SAMPLE = [
  ["RELIANCE", "NIFTY", "8.70%", "+0.82%"],
  ["HDFCBANK", "NIFTY", "12.40%", "+0.54%"],
  ["INFY", "NIFTY", "5.80%", "−0.36%"],
  ["ICICIBANK", "BANKNIFTY", "8.10%", "+0.67%"],
];

function DeskAiBrief({ snap }) {
  return (
    <div className="space-y-2" data-testid="desk-ai-preview">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[10px] font-semibold text-slate-600">Market session briefing</div>
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[8px] font-bold uppercase text-amber-900">Fictional sample</span>
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        {[["NIFTY", snap?.indices?.NIFTY], ["BANKNIFTY", snap?.indices?.BANKNIFTY], ["SENSEX", snap?.indices?.SENSEX]].map(([label, value]) => (
          <div key={label} className="rounded-md border border-slate-200 bg-white px-2 py-1.5">
            <div className="text-[8px] font-semibold text-slate-500">{label}</div>
            <div className={`slz-mono text-[10px] font-bold ${(value?.changePct ?? 0) >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
              {(value?.changePct ?? 0) >= 0 ? "+" : ""}{(value?.changePct ?? 0).toFixed(2)}%
            </div>
          </div>
        ))}
      </div>
      <div className="rounded-md border border-slate-200 bg-white p-2">
        <div className="mb-1.5 text-[9px] font-bold uppercase tracking-wide text-slate-500">Heavyweight moves · index weightage</div>
        {DESK_MARKET_SAMPLE.map(([name, index, weight, move]) => (
          <div key={name} className="grid grid-cols-[1fr_auto_auto] gap-2 border-t border-slate-100 py-1 text-[9px]">
            <span className="font-semibold text-slate-800">{name} <span className="font-normal text-slate-500">· {index}</span></span>
            <span className="font-mono text-slate-500">{weight}</span>
            <span className={`font-mono font-semibold ${move.startsWith("+") ? "text-emerald-700" : "text-rose-700"}`}>{move}</span>
          </div>
        ))}
      </div>
      <div className="rounded-md border border-emerald-100 bg-emerald-50/70 px-2.5 py-2 text-[9px] leading-4 text-emerald-950">
        One consolidated briefing across Market Intel, Global Markets, index breadth and heavyweight movers.
      </div>
    </div>
  );
}

function MarketIntel() {
  const [category, setCategory] = useState("All");
  const categories = ["All", "Breaking", "Critical", "High Impact", "India", "Macro", "RBI", "Fed", "Oil", "Geopolitics", "Corporate"];
  const stories = [
    {
      category: "Corporate",
      severity: "Critical",
      importance: 94,
      direction: "Market direction unclear",
      headline: "Illustrative corporate policy update draws a closer market watch",
      summary: "Example only: a company-specific development may matter when its index weight and market response are material.",
      indiaImpact: "India impact · constituent-specific context",
      volatility: "Volatility low",
      source: "Illustrative source · 2 independent reports",
    },
    {
      category: "India",
      severity: "Critical",
      importance: 88,
      direction: "No directional read",
      headline: "Illustrative domestic policy headline enters the event monitor",
      summary: "Example only: assess the source, timing and market response before treating a headline as a catalyst.",
      indiaImpact: "India impact · domestic policy context",
      volatility: "Volatility watch",
      source: "Illustrative source · 3 independent reports",
    },
    {
      category: "Oil",
      severity: "High",
      importance: 68,
      direction: "Market direction unclear",
      headline: "Illustrative crude-price move puts import costs in focus",
      summary: "Example only: commodity moves can affect inflation expectations and energy-sensitive constituents.",
      indiaImpact: "India impact · import-cost transmission path",
      volatility: "Volatility low",
      source: "Illustrative source · 1 independent report",
    },
  ].filter((story) => category === "All" || story.category === category || category === story.severity || category === "High Impact");
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-slate-50 p-2" data-testid="market-intel-preview">
      <div className="mb-2 flex items-center justify-between gap-2 rounded-md bg-white px-2 py-1.5">
        <div>
          <div className="text-[8px] font-bold uppercase tracking-wide text-emerald-700">Desk</div>
          <div className="text-[11px] font-semibold text-slate-800">Market Intelligence</div>
        </div>
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[8px] font-bold uppercase text-amber-900">Fictional sample</span>
      </div>
      <div className="mb-2 flex gap-1 overflow-x-auto pb-1">
        {categories.map((item) => (
          <button key={item} type="button" onClick={() => setCategory(item)} aria-pressed={category === item} className={`shrink-0 rounded-full border px-2 py-1 text-[7px] font-semibold ${category === item ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-slate-200 bg-white text-slate-600"}`}>
            {item}
          </button>
        ))}
      </div>
      <div className="max-h-72 space-y-1.5 overflow-y-auto">
        {stories.length ? stories.map((story) => (
          <article key={story.headline} className="rounded-md border border-slate-200 bg-white p-2 shadow-sm">
            <div className="flex flex-wrap items-center gap-1">
              <span className={`rounded border px-1.5 py-0.5 text-[7px] font-bold uppercase ${story.severity === "Critical" ? "border-rose-200 bg-rose-50 text-rose-800" : "border-amber-200 bg-amber-50 text-amber-800"}`}>{story.severity}</span>
              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[7px] font-semibold text-slate-700">Importance {story.importance}</span>
              <span className="text-[7px] text-slate-500">{story.direction}</span>
              <span className="ml-auto text-[7px] font-bold uppercase text-slate-500">{story.category}</span>
            </div>
            <div className="mt-1.5 text-[9px] leading-4 text-slate-500">{story.source} · Published: illustrative time</div>
            <h4 className="mt-1 text-[10px] font-bold leading-4 text-slate-900">{story.headline}</h4>
            <p className="mt-1 text-[8px] leading-3 text-slate-600">{story.summary}</p>
            <div className="mt-1 text-[8px] text-slate-700">{story.indiaImpact} · {story.volatility}</div>
            <p className="mt-1 text-[8px] text-slate-500">Possible transmission path is context, not a forecast.</p>
          </article>
        )) : <p className="rounded-md border border-slate-200 bg-white p-3 text-[9px] text-slate-500">No illustrative stories in this filter.</p>}
      </div>
    </div>
  );
}

const JOURNAL_DAYS = [
  { day: 2, kind: "holiday", note: "Holiday" },
  { day: 3, kind: "closed", note: "Market closed" },
  { day: 6, kind: "profit", pnl: 930 },
  { day: 7, kind: "loss", pnl: -3780 },
  { day: 8, kind: "profit", pnl: 3175 },
  { day: 9, kind: "profit", pnl: 2180 },
  { day: 10, kind: "closed", note: "Market closed" },
  { day: 11, kind: "closed", note: "Market closed" },
  { day: 12, kind: "profit", pnl: 1420 },
  { day: 13, kind: "loss", pnl: -4660 },
  { day: 14, kind: "profit", pnl: 3930 },
  { day: 17, kind: "closed", note: "Market closed" },
  { day: 20, kind: "holiday", note: "Holiday" },
  { day: 24, kind: "closed", note: "Market closed" },
  { day: 31, kind: "closed", note: "Market closed" },
];

function TradeJournal() {
  const entries = new Map(JOURNAL_DAYS.map((item) => [item.day, item]));
  const calendarDays = [...Array(4).fill(null), ...Array.from({ length: 31 }, (_, i) => i + 1)];
  return (
    <div className="space-y-2" data-testid="trade-journal-preview">
      <div className="flex items-center justify-between gap-2 rounded-lg border border-emerald-100 bg-emerald-50 px-2.5 py-2">
        <div>
          <div className="text-[8px] font-bold uppercase tracking-wide text-emerald-800">Private member journal</div>
          <div className="text-[11px] font-semibold text-slate-900">October 2026 · sample month</div>
        </div>
        <span className="rounded-full bg-white px-2 py-1 text-[8px] font-bold uppercase text-amber-800">Fictional sample</span>
      </div>
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        {[["Booked P&L", "+₹3,195"], ["Win rate", "71.4%"], ["Trade days", "7"], ["Review tags", "12"]].map(([label, value]) => (
          <div key={label} className="rounded-md border border-slate-200 bg-white px-2 py-1.5">
            <div className="text-[7px] font-bold uppercase tracking-wide text-slate-400">{label}</div>
            <div className="mt-0.5 text-[10px] font-semibold text-slate-800">{value}</div>
          </div>
        ))}
      </div>
      <div className="grid gap-2 sm:grid-cols-[1fr_8rem]">
        <div className="rounded-lg border border-slate-200 bg-white p-2">
          <div className="mb-1.5 flex items-center justify-between text-[8px] font-semibold text-slate-600">
            <span>Monthly trade calendar</span><span>Booked P&amp;L · after charges</span>
          </div>
          <div className="grid grid-cols-7 gap-1 text-center">
            {["S", "M", "T", "W", "T", "F", "S"].map((day, i) => <span key={`${day}-${i}`} className="py-0.5 text-[7px] font-bold text-slate-400">{day}</span>)}
            {calendarDays.map((day, i) => {
              const entry = entries.get(day);
              const color = entry?.kind === "profit"
                ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                : entry?.kind === "loss"
                  ? "border-rose-200 bg-rose-50 text-rose-900"
                  : entry?.kind === "holiday"
                    ? "border-amber-200 bg-amber-50 text-amber-900"
                    : "border-slate-100 bg-slate-50 text-slate-500";
              return (
                <div key={day || `blank-${i}`} className={`min-h-8 rounded border px-0.5 py-1 text-[8px] ${day ? color : "border-transparent"}`}>
                  {day && <><span className="block font-semibold">{day}</span>{entry?.pnl != null && <span className="block truncate text-[6px]">{entry.pnl > 0 ? "+" : ""}{entry.pnl.toLocaleString("en-IN")}</span>}{entry?.note && <span className="block truncate text-[6px]">{entry.note}</span>}</>}
                </div>
              );
            })}
          </div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-2">
          <div className="text-[8px] font-bold uppercase tracking-wide text-slate-500">Weekly recap</div>
          {[["Week 1", "+₹2,505"], ["Week 2", "+₹690"], ["Week 3", "₹0"]].map(([week, pnl]) => (
            <div key={week} className="mt-2 border-t border-slate-100 pt-1.5">
              <div className="text-[7px] text-slate-500">{week}</div>
              <div className="text-[9px] font-semibold text-emerald-700">{pnl}</div>
            </div>
          ))}
          <div className="mt-2 rounded bg-indigo-50 px-1.5 py-1 text-[7px] leading-3 text-indigo-800">Notes and tags stay private to the member account.</div>
        </div>
      </div>
    </div>
  );
}

export default function ProductScreen({ id = "dashboard", snap }) {
  const sampleOi = makeSampleOi("NIFTY");
  const spot = snap?.indices?.NIFTY?.price ?? sampleOi.current.price;
  const atm = snap?.chain?.atm || Math.round(spot / 50) * 50;
  const strikeShift = atm - sampleOi.current.atm;
  const current = {
    ...sampleOi.current,
    price: spot,
    atm,
    strikes: sampleOi.current.strikes.map((row) => ({ ...row, strike: row.strike + strikeShift })),
  };
  const previous = {
    ...sampleOi.previous,
    strikes: sampleOi.previous.strikes.map((row) => ({ ...row, strike: row.strike + strikeShift })),
  };
  switch (id) {
    case "oi":
    case "chain-nifty":
    case "chain-banknifty":
    case "chain-sensex":
      return <div><LandingOiChart current={current} previous={previous} featureId="oi_change" sample /><StatCards snap={snap} /></div>;
    case "positions":
      return <Positions snap={snap} />;
    case "pressure":
      return <Pressure current={current} previous={previous} />;
    case "global-markets":
      return <GlobalMarkets />;
    case "straddle":
      return <StraddlePreview />;
    case "events":
    case "market_events":
      return (
        <div className="grid gap-2 sm:grid-cols-2" data-testid="landing-market-events-preview">
          {[
            ["INDIA · SAMPLE", "RBI policy decision", "Mon · 10:00 IST", "Domestic rates and liquidity watch"],
            ["GLOBAL · SAMPLE", "US CPI release", "Wed · 18:00 IST", "Overnight volatility watch"],
          ].map(([group, event, time, detail]) => (
            <article key={event} className="rounded-lg border border-slate-200 bg-white p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[8px] font-bold uppercase tracking-wide text-indigo-700">{group}</span>
                <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[7px] font-bold uppercase text-amber-900">Illustrative</span>
              </div>
              <h3 className="mt-2 text-[11px] font-bold text-slate-900">{event}</h3>
              <p className="mt-0.5 text-[9px] font-medium text-slate-500">{time}</p>
              <p className="mt-2 text-[9px] leading-4 text-slate-600">{detail}</p>
            </article>
          ))}
        </div>
      );
    case "market-intel":
      return <MarketIntel />;
    case "desk-ai":
      return <DeskAiBrief snap={snap} />;
    case "journal":
      return <TradeJournal />;
    case "dashboard":
    default:
      return (
        <div className="space-y-2">
          <IndexTiles snap={snap} />
          <LandingOiChart current={current} previous={previous} featureId="oi_change" sample />
        </div>
      );
  }
}
