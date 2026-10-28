import React from "react";
import BrowserChrome from "@/components/landing/BrowserChrome";
import OiPulseLogo from "@/components/OiPulseLogo";

// Wraps a REAL Striklenz screenshot in a browser frame and layers a subtle
// live overlay (moving index chip + LIVE badge) so an authentic snapshot still
// feels alive. The screenshot itself is unaltered product imagery.
export default function ShotFrame({ src, alt = "Striklenz", title = "Striklenz Terminal", snap, chipIndex = "NIFTY", className = "", showChip = true }) {
  const d = snap?.indices?.[chipIndex];
  const up = (d?.changePct ?? 0) >= 0;
  return (
    <div className={`slz-browser ${className}`}>
      <BrowserChrome status="live" />
      {showChip && d && (
        <div className="flex justify-end border-b border-slate-100 bg-white px-3 py-1.5">
          <div data-testid="landing-price-chip" className="flex max-w-full items-center gap-1.5">
            <OiPulseLogo className="h-4 w-4 shrink-0" pulse={false} />
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
      <div className="relative bg-white">
        <img src={src} alt={alt} loading="lazy" className="block w-full select-none" draggable={false} />
        <div className="pointer-events-none absolute inset-0" style={{ background: "linear-gradient(180deg, rgba(255,255,255,0) 82%, rgba(15,23,42,0.05) 100%)" }} />
      </div>
    </div>
  );
}
