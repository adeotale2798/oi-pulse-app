import React from "react";
import { LockKeyhole } from "lucide-react";

export default function BrowserChrome({ status = "sample" }) {
  const labels = {
    sample: ["SAMPLE PREVIEW", "SAMPLE", "Illustrative sample preview"],
    live: ["LIVE", "LIVE", "Live publisher market data"],
    "last-session": ["LAST SESSION", "LAST", "Latest saved market session"],
    "pre-market": ["PRE-MARKET", "PRE-MKT", "NSE pre-market; OI is from the last session"],
    delayed: ["DATA DELAYED", "DELAYED", "Publisher market data is delayed"],
    unavailable: ["DATA UNAVAILABLE", "NO DATA", "Market data is unavailable"],
  };
  const [wideLabel, compactLabel, ariaLabel] = labels[status] || labels.sample;
  const isLive = status === "live";
  const statusClass = isLive ? "slz-browser-status-live" : "slz-browser-status-sample";
  const dotClass = isLive ? "slz-live-dot" : "slz-sample-dot";
  return (
    <div className="slz-browser-bar">
      <div className="slz-browser-controls" aria-hidden="true">
        <span className="slz-dot" style={{ background: "#ff5f57" }} />
        <span className="slz-dot" style={{ background: "#febc2e" }} />
        <span className="slz-dot" style={{ background: "#28c840" }} />
      </div>
      <div className="slz-browser-address slz-mono" aria-label="Preview address: striklenz.com/dashboard">
        <LockKeyhole className="h-3 w-3 shrink-0 text-emerald-400" aria-hidden="true" />
        <span className="slz-browser-address-text">
          striklenz.com<span className="slz-browser-route">/dashboard</span>
        </span>
      </div>
      <span
        className={`slz-browser-status ${statusClass}`}
        aria-label={ariaLabel}
      >
        <span className={dotClass} aria-hidden="true" />
        <span className="slz-browser-status-wide">{wideLabel}</span>
        <span className="slz-browser-status-compact">{compactLabel}</span>
      </span>
    </div>
  );
}
