import React from "react";
import { LockKeyhole } from "lucide-react";

export default function BrowserChrome({ status = "sample" }) {
  const isSample = status === "sample";
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
        className={`slz-browser-status ${isSample ? "slz-browser-status-sample" : "slz-browser-status-live"}`}
        aria-label={isSample ? "Illustrative sample preview" : "Live product screenshot"}
      >
        <span className={isSample ? "slz-sample-dot" : "slz-live-dot"} aria-hidden="true" />
        <span className="slz-browser-status-wide">{isSample ? "SAMPLE PREVIEW" : "LIVE"}</span>
        <span className="slz-browser-status-compact">{isSample ? "SAMPLE" : "LIVE"}</span>
      </span>
    </div>
  );
}
