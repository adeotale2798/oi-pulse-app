import React from "react";
import ProductScreen from "@/components/landing/ProductScreen";
import BrowserChrome from "@/components/landing/BrowserChrome";
import OiPulseLogo from "@/components/OiPulseLogo";

// Light StrikLenz terminal frame (mirrors the product UI) with a SENSEX quote chip.
export default function BrowserMock({
  id = "dashboard",
  snap,
  marketData,
  status = "sample",
  chipAlign = "right",
  title = "Striklenz Terminal",
  className = "",
  showChip = true,
  chipIndex = "SENSEX",
}) {
  const d = snap?.indices?.[chipIndex];
  const up = (d?.changePct ?? 0) >= 0;
  return (
    <div className={`slz-browser ${className}`}>
      <BrowserChrome status={status} />
      {showChip && d && (
        <div className={`flex ${chipAlign === "left" ? "justify-start" : "justify-end"} border-b border-slate-100 bg-white px-3 py-1.5`}>
          <div data-testid="landing-price-chip" className="flex max-w-full items-center gap-1.5">
            <OiPulseLogo className="h-4 w-4 shrink-0" pulse={false} />
            <div className="min-w-0 leading-none">
              <span className="mr-1 text-[9px] font-semibold text-slate-500">{chipIndex}</span>
              <span className="slz-mono whitespace-nowrap text-[10px] font-bold text-slate-900">{Number(d.price).toLocaleString("en-IN", { maximumFractionDigits: 2 })}</span>
            </div>
            <span className={`inline-flex shrink-0 items-center rounded-full px-1.5 py-0.5 slz-mono whitespace-nowrap text-[9px] font-bold ${up ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>
              {d.changePct == null ? "—" : `${up ? "+" : "-"}${Math.abs(d.changePct).toFixed(2)}%`}
            </span>
          </div>
        </div>
      )}
      <div className="relative bg-white p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[11px] font-semibold text-slate-500">{title}</span>
          <span className="slz-mono text-[10px] text-slate-400">Auto-refresh · 15s</span>
        </div>
        <ProductScreen id={id} snap={snap} marketData={marketData} marketStatus={status} />
      </div>
    </div>
  );
}
