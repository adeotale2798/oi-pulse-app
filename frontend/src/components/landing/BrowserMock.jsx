import React from "react";
import ProductScreen from "@/components/landing/ProductScreen";
import BrowserChrome from "@/components/landing/BrowserChrome";

// Light Striklenz terminal frame (mirrors the real product UI) with a floating
// live SENSEX chip overlay for that "live terminal" feel.
export default function BrowserMock({ id = "dashboard", snap, title = "Striklenz Terminal", className = "", showChip = true, chipIndex = "SENSEX" }) {
  const d = snap?.indices?.[chipIndex];
  const up = (d?.changePct ?? 0) >= 0;
  return (
    <div className={`slz-browser ${className}`}>
      <BrowserChrome />
      {showChip && d && (
        <div className="flex justify-end border-b border-slate-100 bg-white px-3 py-1.5">
          <div data-testid="landing-price-chip" className="flex max-w-full items-center gap-1.5">
            <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded bg-emerald-500 text-[9px] font-bold text-white">S</span>
            <div className="min-w-0 leading-none">
              <span className="mr-1 text-[9px] font-semibold text-slate-500">{chipIndex}</span>
              <span className="slz-mono whitespace-nowrap text-[10px] font-bold text-slate-900">{Number(d.price).toLocaleString("en-IN", { maximumFractionDigits: 2 })}</span>
            </div>
            <span className={`inline-flex shrink-0 items-center rounded-full px-1.5 py-0.5 slz-mono whitespace-nowrap text-[9px] font-bold ${up ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>
              {up ? "+" : "-"}{Math.abs(d.changePct).toFixed(2)}%
            </span>
          </div>
        </div>
      )}
      <div className="relative bg-white p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[11px] font-semibold text-slate-500">{title}</span>
          <span className="slz-mono text-[10px] text-slate-400">Auto-refresh · 15s</span>
        </div>
        <ProductScreen id={id} snap={snap} />
      </div>
    </div>
  );
}
