import React, { useEffect, useMemo, useState } from "react";
import { Activity, AlertCircle, Globe2, LockKeyhole, Newspaper, Sparkles } from "lucide-react";
import { api } from "@/lib/api";
import CapturedPlanPreview from "@/components/landing/CapturedPlanPreview";
import ProductScreen from "@/components/landing/ProductScreen";
import { PLAN_FEATURE_DETAILS } from "@/components/landing/planFeatureDetails";
import {
  SAMPLE_DESK_MARKET,
  SAMPLE_EVENTS,
  SAMPLE_GLOBAL_MARKETS,
  SAMPLE_MARKET_INTEL,
  SAMPLE_PERSONAL_ALERTS,
  SAMPLE_PREVIEW_LABEL,
} from "@/components/landing/planPreviewSamples";

export { PLAN_FEATURE_DETAILS } from "@/components/landing/planFeatureDetails";

function SelectField({ label, value, onChange, options }) {
  return (
    <label className="block min-w-0">
      <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</span>
      <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs font-medium text-slate-800">
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}

function PreviewHeading({ eyebrow, title, children }) {
  return (
    <div className="mb-4">
      <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-700">{eyebrow}</div>
      <h4 className="mt-1 text-base font-bold text-slate-900">{title}</h4>
      {children && <p className="mt-1 text-xs leading-5 text-slate-500">{children}</p>}
    </div>
  );
}

function AlertPreview({ featureId }) {
  const [index, setIndex] = useState("NIFTY");
  const [threshold, setThreshold] = useState(100_000);
  const [changeThreshold, setChangeThreshold] = useState(15);
  const [leadDays, setLeadDays] = useState(2);
  const [enabled, setEnabled] = useState(true);
  const [alertIndex, setAlertIndex] = useState("all");
  const [acknowledgedAlerts, setAcknowledgedAlerts] = useState([]);

  if (featureId === "alert_sounds") {
    return (
      <div>
        <PreviewHeading eyebrow="Alert sound preference · demo only" title="Choose whether eligible alerts play a sound">
          This local preview does not play audio or save a member preference.
        </PreviewHeading>
        <label className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-4 text-sm font-semibold text-slate-800">
          Play alert sounds
          <input aria-label="Play alert sounds" type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
        </label>
        <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">Preview only · no sound will play and this setting is not saved.</p>
      </div>
    );
  }

  if (featureId === "oi_change_alerts") {
    const exampleChange = 18;
    return (
      <div>
        <PreviewHeading eyebrow="Personal OI-change alerts · demo only" title="Set the minimum OI-change threshold">
          Choose an index and sensitivity; the example is fictional and is not a real subscriber alert.
        </PreviewHeading>
        <div className="grid gap-3 sm:grid-cols-2">
          <SelectField label="Index" value={index} onChange={setIndex} options={["NIFTY", "SENSEX", "BANKNIFTY"].map((value) => ({ value, label: value }))} />
          <label className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            Minimum OI change <span className="mt-1 block rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs font-medium normal-case text-slate-800">{changeThreshold}%</span>
            <input aria-label="Minimum OI change" type="range" min="5" max="30" step="1" value={changeThreshold} onChange={(event) => setChangeThreshold(Number(event.target.value))} className="mt-1 w-full accent-emerald-600" />
          </label>
        </div>
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <span className="rounded-full bg-white px-2 py-1 text-[10px] font-semibold text-amber-800">Fictional example</span>
          <p className="mt-2 text-sm font-semibold text-slate-900">{index} OI change · +{exampleChange}%</p>
          <p className="mt-1 text-xs text-slate-600">This example {exampleChange >= changeThreshold ? "crosses" : "does not cross"} your selected {changeThreshold}% threshold.</p>
        </div>
      </div>
    );
  }

  if (featureId === "event_alerts") {
    return (
      <div>
        <PreviewHeading eyebrow="Event alerts · demo only" title="Choose how far ahead to surface a calendar reminder">
          Sample event context is fictional; changing these controls does not save a preference or schedule a notification.
        </PreviewHeading>
        <div className="grid gap-3 sm:grid-cols-2">
          <SelectField label="Index" value={index} onChange={setIndex} options={["NIFTY", "SENSEX", "BANKNIFTY"].map((value) => ({ value, label: value }))} />
          <SelectField label="Reminder lead time" value={String(leadDays)} onChange={(value) => setLeadDays(Number(value))} options={[1, 2, 5, 7].map((value) => ({ value: String(value), label: `${value} days ahead` }))} />
        </div>
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <span className="rounded-full bg-white px-2 py-1 text-[10px] font-semibold text-amber-800">Fictional calendar example</span>
          <p className="mt-2 text-sm font-semibold text-slate-900">{index} · Scheduled policy announcement</p>
          <p className="mt-1 text-xs text-slate-600">Reminder window: {leadDays} days before the event.</p>
        </div>
      </div>
    );
  }

  if (featureId === "alerts") {
    const alerts = alertIndex === "all"
      ? SAMPLE_PERSONAL_ALERTS
      : SAMPLE_PERSONAL_ALERTS.filter((alert) => alert.index === alertIndex);
    return (
      <div>
        <PreviewHeading eyebrow="Personal alerts inbox · demo only" title="Review an alert in your private inbox">
          Browse sample OI, Market Intel, Global Markets, major-move, and event updates. Every row and acknowledgement is fictional and stays in this browser preview.
        </PreviewHeading>
        <div className="rounded-xl border border-slate-200 bg-white">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-slate-50 p-3">
            <div>
              <div className="text-xs font-bold text-slate-900">Premium alert inbox</div>
              <div className="mt-1 text-[10px] text-slate-500">{alerts.length} illustrative updates · sample only</div>
            </div>
            <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              Index
              <select aria-label="Alert inbox index" value={alertIndex} onChange={(event) => setAlertIndex(event.target.value)} className="ml-2 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs font-medium normal-case text-slate-800">
                <option value="all">All indices</option>
                {["NIFTY", "SENSEX", "BANKNIFTY"].map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
          </div>
          <div className="max-h-[360px] space-y-2 overflow-y-auto p-3">
            {alerts.map((alert) => {
              const acknowledged = acknowledgedAlerts.includes(alert.id);
              return (
                <article key={alert.id} className="flex items-start justify-between gap-3 rounded-lg border border-slate-200 p-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[9px] font-bold text-indigo-800">{alert.category}</span>
                      <span className="text-[9px] font-semibold text-slate-500">{alert.index}</span>
                      <span className="text-[9px] text-slate-400">{alert.at}</span>
                    </div>
                    <div className="mt-1 text-xs font-bold text-slate-900">{alert.title}</div>
                    <p className="mt-1 text-[10px] leading-4 text-slate-600">{alert.detail}</p>
                  </div>
                  <button
                    type="button"
                    aria-label={`${acknowledged ? "Unacknowledge" : "Acknowledge"} ${alert.category} sample`}
                    onClick={() => setAcknowledgedAlerts((current) => acknowledged
                      ? current.filter((id) => id !== alert.id)
                      : [...current, alert.id])}
                    className="shrink-0 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[10px] font-semibold text-slate-700"
                  >
                    {acknowledged ? "Acknowledged" : "Acknowledge"}
                  </button>
                </article>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  const exampleContracts = 125_000;
  return (
    <div>
      <PreviewHeading eyebrow="Personal OI-shift alerts · demo only" title="Set a threshold for rapid strike shifts">
        Choose an index and minimum contract shift. Member alert history and preferences are not copied into this public walkthrough.
      </PreviewHeading>
      <div className="grid gap-3 sm:grid-cols-3">
        <SelectField label="Index" value={index} onChange={setIndex} options={["NIFTY", "SENSEX", "BANKNIFTY"].map((value) => ({ value, label: value }))} />
        <label className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500">
          Minimum contracts <span className="mt-1 block rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs font-medium normal-case text-slate-800">{threshold.toLocaleString("en-IN")}</span>
          <input aria-label="Minimum contracts" type="range" min="25000" max="250000" step="25000" value={threshold} onChange={(event) => setThreshold(Number(event.target.value))} className="mt-1 w-full accent-emerald-600" />
        </label>
      </div>
      <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
        <div className="flex items-center justify-between gap-2"><span className="text-xs font-bold text-amber-950">{index} · OI shift</span><span className="rounded-full bg-white px-2 py-1 text-[10px] font-semibold text-amber-800">Fictional example</span></div>
        <p className="mt-2 text-sm font-semibold text-slate-900">Example trigger · {exampleContracts.toLocaleString("en-IN")} contracts</p>
        <p className="mt-1 text-xs text-slate-600">This example {exampleContracts >= threshold ? "crosses" : "does not cross"} the selected threshold of {threshold.toLocaleString("en-IN")}.</p>
        <p className="mt-2 text-[10px] text-slate-500">No real alert or subscriber preference is shown.</p>
      </div>
    </div>
  );
}

function PositionsPreview() {
  const [index, setIndex] = useState("SENSEX");
  return (
    <div>
      <PreviewHeading eyebrow="Pro private workspace · demo only" title="Explore the personal-book workflow">
        Every contract and P&amp;L value below is fictional. The walkthrough never reads broker credentials or a subscriber&apos;s positions, and does not provide position guidance.
      </PreviewHeading>
      <div className="mb-3 max-w-xs">
        <SelectField label="Underlying" value={index} onChange={setIndex} options={["NIFTY", "SENSEX", "BANKNIFTY"].map((value) => ({ value, label: value }))} />
      </div>
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="flex items-center justify-between gap-3 bg-slate-50 px-3 py-2"><span className="text-xs font-bold text-slate-800">{index} · Private broker book</span><span className="text-[10px] font-semibold text-amber-700">FICTIONAL</span></div>
        {[["24,800 PE", "−50", "₹84.5", "−₹420"], ["25,200 CE", "−25", "₹76.0", "+₹315"]].map(([contract, quantity, price, pnl]) => <div key={contract} className="grid grid-cols-[1fr_auto_auto] gap-3 border-t border-slate-100 px-3 py-3 text-xs"><span className="font-semibold text-slate-800">{index} {contract}</span><span className="text-slate-500">{quantity} · {price}</span><span className="font-bold text-slate-700">{pnl}</span></div>)}
      </div>
      <div className="mt-3 flex items-center gap-2 text-[10px] text-slate-500"><LockKeyhole className="h-3.5 w-3.5" /> Real Pro books remain private to their signed-in member.</div>
    </div>
  );
}

function OvernightRiskPreview() {
  return (
    <div data-testid="overnight-risk-preview">
      <PreviewHeading eyebrow="Pro risk context · fictional example" title="See the inputs behind an overnight risk summary">
        Sample readings demonstrate the factor breakdown only. This preview does not connect a broker account or give position-specific guidance.
      </PreviewHeading>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-indigo-100 bg-indigo-50 p-4">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wide text-indigo-700">Illustrative factor score</div>
          <div className="mt-1 text-2xl font-bold text-indigo-950">42 <span className="text-sm font-medium">/ 100</span></div>
        </div>
        <span className="rounded-full border border-indigo-200 bg-white px-3 py-1.5 text-[10px] font-bold text-indigo-800">FICTIONAL EXAMPLE</span>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {[
          ["India VIX", "14.8", "Market volatility input"],
          ["Book delta", "₹12,400 / 1%", "Fictional broker-book exposure input"],
          ["Time to expiry", "3 sessions", "Calendar input"],
          ["Scheduled events", "2 upcoming", "Shared calendar context"],
        ].map(([label, value, detail]) => (
          <article key={label} className="rounded-xl border border-slate-200 bg-white p-3">
            <div className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
            <div className="mt-1 text-sm font-bold text-slate-900">{value}</div>
            <p className="mt-1 text-[10px] leading-4 text-slate-500">{detail}</p>
          </article>
        ))}
      </div>
      <p className="mt-3 text-[10px] leading-4 text-slate-500">The score summarizes reported factors; it is not a forecast or an instruction to change a position.</p>
    </div>
  );
}

function JournalPreview() {
  const [note, setNote] = useState("Reviewed the opening range and recorded a personal learning note.");
  return (
    <div>
      <PreviewHeading eyebrow="Private Trade Journal · demo only" title="Review a sample journal month">
        The text below exists only in this browser walkthrough. It is not saved, uploaded, or taken from a member journal.
      </PreviewHeading>
      <ProductScreen id="journal" />
      <label className="mt-3 block rounded-xl border border-slate-200 bg-white p-4 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
        Try editing this local sample note · not saved
        <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={3} className="mt-2 w-full resize-y rounded-lg border border-slate-200 px-3 py-2 text-xs font-normal normal-case leading-5 text-slate-700" />
      </label>
    </div>
  );
}

function DeskAiPreview({ snapshot }) {
  const source = snapshot?.desk_market;
  const capturedMarket = source?.status === "captured" ? source.data : null;
  const hasCapturedMovers = Boolean(capturedMarket?.movers?.length);
  const hasCapturedBreadth = Boolean(Object.keys(capturedMarket?.breadth || {}).length);
  const market = {
    ...SAMPLE_DESK_MARKET,
    ...(capturedMarket || {}),
    movers: hasCapturedMovers ? capturedMarket.movers : SAMPLE_DESK_MARKET.movers,
    breadth: hasCapturedBreadth ? capturedMarket.breadth : SAMPLE_DESK_MARKET.breadth,
  };
  const movers = Array.isArray(market?.movers) ? market.movers : [];
  const breadthRows = Object.entries(market?.breadth || {});
  const capturedIntel = snapshot?.market_intel?.status === "captured" ? snapshot.market_intel.data?.items || [] : [];
  const capturedGlobal = snapshot?.global_markets?.status === "captured" ? snapshot.global_markets.data?.items || [] : [];
  const hasCapturedIntel = capturedIntel.length > 0;
  const hasCapturedGlobal = capturedGlobal.length > 0;
  const intelItems = hasCapturedIntel ? capturedIntel : SAMPLE_MARKET_INTEL;
  const globalItems = hasCapturedGlobal ? capturedGlobal : SAMPLE_GLOBAL_MARKETS;
  const eventCount = Object.values(snapshot?.indices || {})
    .flatMap((index) => index?.events?.status === "captured" ? index.events.data?.events || [] : [])
    .length;
  const hasCapturedEvents = eventCount > 0;
  const sample = !hasCapturedMovers || !hasCapturedBreadth || !hasCapturedIntel || !hasCapturedGlobal || !hasCapturedEvents;
  return (
    <div data-testid="desk-ai-market-brief">
      <PreviewHeading eyebrow="Desk AI · market briefing" title="A read-only view of what is moving the session">
        Desk AI brings Market Intel, Global Markets, Indian index breadth, heavyweight moves and event context together in one consolidated market briefing.
      </PreviewHeading>
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50 px-3 py-2">
          <div className="flex items-center gap-2 text-xs font-bold text-slate-800"><Sparkles className="h-4 w-4 text-emerald-600" /> Market today</div>
          <span className="rounded-full bg-amber-100 px-2 py-1 text-[9px] font-bold uppercase text-amber-900">{sample ? SAMPLE_PREVIEW_LABEL : "Admin-captured · static"}</span>
        </div>
        <div className="grid gap-2 p-3 sm:grid-cols-3">
          {breadthRows.length ? breadthRows.map(([index, breadth]) => (
            <div key={index} className="rounded-lg border border-slate-200 bg-slate-50 p-2.5" data-testid={`desk-ai-breadth-${index}`}>
              <div className="text-[9px] font-bold uppercase tracking-wide text-slate-500">{index} breadth</div>
              <div className="mt-1 text-sm font-bold text-slate-900">{breadth.adv ?? "—"} advancing <span className="font-normal text-slate-400">/</span> {breadth.dec ?? "—"} declining</div>
              <div className="mt-1 text-[10px] text-slate-500">{breadth.n ?? "—"} constituents captured</div>
            </div>
          )) : (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900" data-testid="desk-ai-breadth-unavailable">
              Breadth was unavailable in this capture.
            </div>
          )}
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
            <div className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-wide text-indigo-700"><Newspaper className="h-3.5 w-3.5" /> Market Intel</div>
            <div className="mt-1 text-sm font-bold text-slate-900">{hasCapturedIntel ? `${intelItems.length} captured stories` : `${intelItems.length} illustrative stories`}</div>
            <div className="mt-1 text-[10px] text-slate-500">News context, not a trade signal</div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
            <div className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-wide text-sky-700"><Globe2 className="h-3.5 w-3.5" /> Global Markets</div>
            <div className="mt-1 text-sm font-bold text-slate-900">{hasCapturedGlobal ? `${globalItems.length} captured instruments` : `${globalItems.length} illustrative instruments`}</div>
            <div className="mt-1 text-[10px] text-slate-500">Outside-market reference data</div>
          </div>
        </div>
        <div className="border-t border-slate-100 px-3 py-2">
          <div className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-600"><Activity className="h-3.5 w-3.5 text-emerald-700" /> Heavyweight moves · weight in index</div>
          {movers.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[26rem] text-[10px]" data-testid="desk-ai-movers">
                <thead className="text-[9px] uppercase tracking-wide text-slate-500">
                  <tr><th className="pb-1 text-left">Company</th><th className="pb-1 text-left">Index</th><th className="pb-1 text-right">Weight</th><th className="pb-1 text-right">Move</th></tr>
                </thead>
                <tbody>{movers.slice(0, 6).map((mover, position) => (
                  <tr key={`${mover.index}-${mover.symbol}-${position}`} className="border-t border-slate-100">
                    <td className="py-1.5 font-semibold text-slate-800">{mover.symbol || "—"}</td>
                    <td className="py-1.5 text-slate-500">{mover.index || "—"}</td>
                    <td className="py-1.5 text-right font-mono text-slate-700">{mover.weightage == null ? "—" : `${Number(mover.weightage).toFixed(2)}%`}</td>
                    <td className={`py-1.5 text-right font-mono font-semibold ${Number(mover.pct) >= 0 ? "text-emerald-700" : "text-rose-700"}`}>{mover.pct == null ? "—" : `${Number(mover.pct) > 0 ? "+" : ""}${Number(mover.pct).toFixed(2)}%`}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          ) : <p className="text-xs text-slate-500">No heavyweight moves are available in this preview.</p>}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-slate-100 px-3 py-2 text-[10px] text-slate-500">
          <span>{hasCapturedEvents ? `${eventCount} captured index events` : `${SAMPLE_EVENTS.length} illustrative events`}</span>
          <span>{market?.quote_source ? "Captured cash market references" : "Illustrative market references"}</span>
          {market?.updated_at && !sample && <span>Updated {new Date(market.updated_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST</span>}
        </div>
      </div>
      <p className="mt-2 text-[10px] leading-4 text-slate-500">{sample ? "Illustrative sample values are shown where a feed was unavailable; they are not live market data." : "Weight and price moves are captured market evidence, not estimated index contribution or a forecast."}</p>
    </div>
  );
}

function FeaturePreview({ planId, feature, copy, snapshot }) {
  const detail = PLAN_FEATURE_DETAILS[feature.id];
  const marketPreviews = ["oi", "calendar", "risk", "intel", "global", "candidates", "activity"];
  let preview;
  if (marketPreviews.includes(detail.preview)) {
    preview = <CapturedPlanPreview featureId={feature.id} snapshot={snapshot} />;
  } else if (detail.preview === "alerts") {
    preview = <AlertPreview featureId={feature.id} />;
  } else if (detail.preview === "positions") {
    preview = <PositionsPreview />;
  } else if (detail.preview === "overnight_risk") {
    preview = <OvernightRiskPreview />;
  } else if (detail.preview === "journal") {
    preview = <JournalPreview />;
  } else if (detail.preview === "ai") {
    preview = <DeskAiPreview snapshot={snapshot} />;
  }
  const description = feature.id === "desk_ai" ? detail.description : copy?.description ?? detail.description;
  const edge = feature.id === "desk_ai" ? detail.edge : copy?.edge ?? detail.edge;
  const tease = planId === "pro" && feature.id === "overnight_position_risk";
  return (
    <div>
      <div className="mb-4 rounded-xl border border-emerald-100 bg-emerald-50/70 p-3">
        <div className="text-sm font-bold text-slate-900">{feature.label}</div>
        <p className="mt-1 text-xs leading-5 text-slate-700">{description}</p>
        <p className="mt-2 text-xs leading-5 text-emerald-900"><b>Your edge:</b> {edge}</p>
      </div>
      <div className="relative rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:p-5">
        {tease && <div className="mb-3 flex items-center gap-2 rounded-lg border border-indigo-100 bg-indigo-50 px-3 py-2 text-[10px] font-semibold text-indigo-900"><LockKeyhole className="h-3.5 w-3.5" /> Pro preview · key controls are intentionally softened</div>}
        <fieldset disabled={tease} className={`min-w-0 border-0 p-0 ${tease ? "select-none blur-[2px] opacity-60" : ""}`} aria-hidden={tease ? "true" : undefined}>{preview}</fieldset>
        {tease && <span className="sr-only">Detailed interaction is reserved for Pro.</span>}
      </div>
    </div>
  );
}

export default function PlanWalkthrough({ planId, features, previewSettings = null }) {
  const [planSettings, setPlanSettings] = useState(null);
  const [settingsError, setSettingsError] = useState("");
  const [selectedFeature, setSelectedFeature] = useState("");
  const useLocalPreview = Boolean(previewSettings);

  useEffect(() => {
    if (useLocalPreview) return undefined;
    let active = true;
    setPlanSettings(null);
    setSettingsError("");
    api.get(`/public/landing-plan-preview/${planId}`)
      .then(({ data }) => { if (active) setPlanSettings(data); })
      .catch(() => {
        if (active) setSettingsError("Admin walkthrough settings could not be loaded. Labeled illustrative samples will remain visible; shared captured values will appear when available.");
      });
    return () => { active = false; };
  }, [planId, useLocalPreview]);

  const settings = previewSettings || planSettings;
  const availableFeatures = useMemo(() => {
    const entitled = new Map(features.map((feature) => [feature.id, feature]));
    const ids = settings?.features || features.map((feature) => feature.id);
    return ids
      .filter((featureId) => PLAN_FEATURE_DETAILS[featureId] && entitled.has(featureId))
      .map((featureId) => ({
        ...entitled.get(featureId),
        label: entitled.get(featureId).label || PLAN_FEATURE_DETAILS[featureId].title,
      }));
  }, [features, settings]);

  useEffect(() => {
    if (!availableFeatures.some((feature) => feature.id === selectedFeature)) {
      setSelectedFeature(availableFeatures[0]?.id || "");
    }
  }, [availableFeatures, selectedFeature]);

  const activeFeature = availableFeatures.find((feature) => feature.id === selectedFeature);
  if (!activeFeature) return <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600">No feature walkthrough is currently configured for this plan.</p>;

  const snapshot = settings?.snapshot || null;
  const previewCopy = settings?.copy?.[activeFeature.id];
  return (
    <section className="space-y-4" aria-label={`${planId} interactive plan walkthrough`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-slate-900">Explore the plan, feature by feature</h3>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-500">Shared-market modules use an Admin-captured app snapshot and stay unchanged until Admin refreshes it. Personal accounts and journals are never used as public preview data.</p>
        </div>
        <span className={`rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${snapshot ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-800"}`}>
          {snapshot ? "Saved capture + labeled samples" : "Labeled sample previews"}
        </span>
      </div>
      {settingsError && <p role="status" className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{settingsError}</p>}
      <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
        <nav aria-label="Plan features" className="flex max-h-[55vh] flex-row gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-y-auto lg:overflow-x-hidden lg:pr-1">
          {availableFeatures.map((feature) => (
            <button key={feature.id} type="button" aria-pressed={feature.id === selectedFeature} onClick={() => setSelectedFeature(feature.id)} className={`shrink-0 rounded-xl border px-3 py-2.5 text-left text-xs font-semibold transition lg:w-full ${feature.id === selectedFeature ? "border-emerald-300 bg-emerald-50 text-emerald-900" : "border-slate-200 bg-white text-slate-600 hover:border-emerald-200 hover:text-slate-900"}`}>
              {feature.label}
            </button>
          ))}
        </nav>
        <div className="min-w-0">
          <FeaturePreview key={selectedFeature} planId={planId} feature={activeFeature} copy={previewCopy} snapshot={snapshot} />
        </div>
      </div>
    </section>
  );
}
