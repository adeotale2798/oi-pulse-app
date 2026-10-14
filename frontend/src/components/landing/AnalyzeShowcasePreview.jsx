import React from "react";

const SAMPLE_LEGS = [
  { side: "B", contract: "15 Oct · 68,500 PE", qty: "700", pnl: "−410", positive: false },
  { side: "S", contract: "15 Oct · 71,400 PE", qty: "240", pnl: "+1,541", positive: true },
  { side: "S", contract: "15 Oct · 71,500 PE", qty: "420", pnl: "+3,316", positive: true },
  { side: "S", contract: "15 Oct · 74,100 CE", qty: "200", pnl: "+431", positive: true },
  { side: "B", contract: "15 Oct · 76,300 CE", qty: "40", pnl: "−163", positive: false },
];

const OI_BARS = [
  [8, 14], [14, 20], [20, 13], [12, 24], [18, 17], [25, 14], [32, 20],
  [28, 25], [18, 31], [14, 22], [20, 17], [26, 13], [16, 10], [10, 15],
];

export default function AnalyzeShowcasePreview() {
  return (
    <section
      className="overflow-hidden rounded-xl border border-slate-200 bg-white text-slate-700 shadow-xl"
      data-testid="landing-analyze-preview"
      aria-label="Illustrative Analyze preview"
    >
      <header className="flex items-center justify-between gap-3 border-b border-emerald-100 bg-gradient-to-r from-emerald-50 to-white px-4 py-3">
        <div>
          <h3 className="text-sm font-bold text-slate-900">Analyze</h3>
          <p className="text-[10px] text-slate-500">P&amp;L vs spot · adjust a sample scenario</p>
        </div>
        <span className="shrink-0 rounded-full bg-amber-100 px-2.5 py-1 text-[9px] font-bold uppercase text-amber-900">Fictional sample</span>
      </header>

      <div className="grid min-w-0 lg:grid-cols-[175px_minmax(0,1fr)_155px]">
        <aside className="border-b border-slate-100 bg-emerald-50/30 p-3 lg:border-b-0 lg:border-r">
          <div className="mb-2 flex items-center justify-between text-[9px] font-bold uppercase tracking-wide text-slate-500">
            <span>Sample legs</span><span>5 open</span>
          </div>
          <div className="space-y-1.5">
            {SAMPLE_LEGS.map((leg) => (
              <div key={leg.contract} className="rounded-md border border-slate-100 bg-white px-2 py-1.5">
                <div className="flex items-center gap-1.5 text-[9px] font-semibold text-slate-700">
                  <span className={`inline-flex h-4 w-4 items-center justify-center rounded text-[8px] text-white ${leg.side === "B" ? "bg-emerald-600" : "bg-rose-600"}`}>{leg.side}</span>
                  <span className="truncate">{leg.qty} × {leg.contract}</span>
                </div>
                <div className={`mt-0.5 pl-[22px] font-mono-data text-[9px] ${leg.positive ? "text-emerald-700" : "text-rose-600"}`}>{leg.pnl}</div>
              </div>
            ))}
          </div>
        </aside>

        <div className="min-w-0 p-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="rounded bg-emerald-600 px-2 py-1 text-[9px] font-bold text-white">S</span>
              <span className="text-[10px] font-bold text-slate-800">SENSEX</span>
              <span className="font-mono-data text-[10px] text-slate-600">72,781.89</span>
              <span className="font-mono-data text-[9px] text-emerald-700">+0.34%</span>
            </div>
            <span className="text-[9px] text-slate-500">Live sample P&amp;L <b className="font-mono-data text-emerald-700">+5,060</b></span>
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-slate-100 pb-2 text-[8px] text-slate-500">
            <span className="inline-flex items-center gap-1"><i className="h-0.5 w-3 bg-blue-600" />Now / date</span>
            <span className="inline-flex items-center gap-1"><i className="h-0.5 w-3 bg-emerald-600" />Expiry</span>
            <span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-sm bg-rose-500" />Call OI</span>
            <span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-sm bg-emerald-600" />Put OI</span>
          </div>

          <svg viewBox="0 0 620 250" className="mt-1 block h-auto w-full" role="img" aria-label="Fictional sample payoff chart with current and expiry curves">
            {[62, 104, 146, 188].map((y) => <line key={y} x1="44" x2="600" y1={y} y2={y} stroke="#e2e8f0" strokeWidth="1" />)}
            {OI_BARS.map(([put, call], index) => {
              const x = 60 + index * 38;
              return (
                <g key={x} opacity="0.45">
                  <rect x={x} y={214 - put * 1.4} width="8" height={put * 1.4} rx="1" fill="#16a34a" />
                  <rect x={x + 9} y={214 - call * 1.4} width="8" height={call * 1.4} rx="1" fill="#dc2626" />
                </g>
              );
            })}
            <path d="M44 192 C110 157 151 87 218 68 C266 53 304 55 328 55 C383 54 424 55 456 72 C508 98 548 148 600 172" fill="none" stroke="#2563eb" strokeWidth="3" strokeLinecap="round" />
            <path d="M44 220 C112 178 150 103 218 61 C264 42 305 46 328 48 C388 49 425 44 456 59 C514 86 551 143 600 174" fill="none" stroke="#059669" strokeWidth="3" strokeLinecap="round" />
            <line x1="328" x2="328" y1="32" y2="214" stroke="#334155" strokeDasharray="4 4" strokeWidth="1.5" />
            <rect x="290" y="18" width="76" height="18" rx="9" fill="#1e293b" />
            <text x="328" y="30" textAnchor="middle" fontSize="9" fill="white">Current 72,782</text>
            <text x="44" y="238" fontSize="9" fill="#64748b">68,415</text>
            <text x="600" y="238" textAnchor="end" fontSize="9" fill="#64748b">77,149</text>
            <text x="12" y="52" fontSize="9" fill="#64748b">P&amp;L</text>
            <rect x="274" y="219" width="108" height="20" rx="10" fill="#059669" />
            <text x="328" y="233" textAnchor="middle" fontSize="10" fontWeight="700" fill="white">Projected +5,202</text>
          </svg>

          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              ["Spot target", "72,782"],
              ["Date", "24h to expiry"],
              ["Move band", "49%"],
              ["Break-evens", "71,454 · 74,202"],
            ].map(([label, value]) => (
              <div key={label} className="min-w-0 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5">
                <div className="text-[8px] font-bold uppercase tracking-wide text-slate-400">{label}</div>
                <div className="mt-0.5 truncate font-mono-data text-[10px] font-semibold text-slate-700">{value}</div>
              </div>
            ))}
          </div>
        </div>

        <aside className="border-t border-slate-100 bg-slate-50/70 p-3 lg:border-l lg:border-t-0">
          <div className="text-[9px] font-bold uppercase tracking-wide text-slate-500">Scenario summary</div>
          <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-1">
            {[
              ["Max profit", "+20,878", "text-emerald-700"],
              ["Max loss", "Unlimited", "text-rose-600"],
              ["Change in band", "49%", "text-slate-800"],
              ["At target", "+5,202", "text-emerald-700"],
              ["Breakevens", "71,454 · 74,202", "text-slate-800"],
            ].map(([label, value, tone]) => (
              <div key={label}>
                <div className="text-[8px] font-semibold uppercase text-slate-400">{label}</div>
                <div className={`mt-0.5 font-mono-data text-[10px] font-semibold ${tone}`}>{value}</div>
              </div>
            ))}
          </div>
          <p className="mt-3 border-t border-slate-200 pt-2 text-[8px] leading-4 text-slate-500">Synthetic example only. Scenario values are not a forecast or recommendation.</p>
        </aside>
      </div>
    </section>
  );
}
