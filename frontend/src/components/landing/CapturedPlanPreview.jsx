import React, { useMemo, useState } from "react";
import { AlertCircle, CalendarDays, Clock3, Database, Globe2, Newspaper } from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import LandingOiChart from "@/components/landing/LandingOiChart";
import { classifyBuildups } from "@/lib/buildup";
import { upcomingHolidays } from "@/lib/holidays";
import {
  makeSampleOi,
  SAMPLE_ACTIVITY,
  SAMPLE_EVENTS,
  SAMPLE_GLOBAL_MARKETS,
  SAMPLE_MARKET_INTEL,
  SAMPLE_PREVIEW_LABEL,
  SAMPLE_STRADDLE,
} from "@/components/landing/planPreviewSamples";

const INDICES = ["NIFTY", "SENSEX", "BANKNIFTY"];
const EMPTY_ITEMS = [];

function formatCapturedAt(value) {
  if (!value) return "No capture time";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Capture time unavailable"
    : date.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) + " IST";
}

function formatNumber(value, digits = 2) {
  const number = Number(value);
  return Number.isFinite(number)
    ? number.toLocaleString("en-IN", { maximumFractionDigits: digits })
    : "—";
}

function Unavailable({ children }) {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs leading-5 text-amber-900">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{children || "This data was unavailable in the saved capture. An Admin can refresh the plan preview data."}</span>
    </div>
  );
}

function CaptureStamp({ snapshot, label, sample = false, sampleLabel, sampleNote }) {
  return (
    <div className={`mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-[10px] ${sample ? "border-amber-200 bg-amber-50 text-amber-950" : "border-emerald-100 bg-emerald-50/70 text-emerald-950"}`}>
      <span className={`inline-flex items-center gap-1.5 font-semibold ${sample ? "text-amber-900" : ""}`}><Database className="h-3.5 w-3.5" /> {sample ? sampleLabel || SAMPLE_PREVIEW_LABEL : label}</span>
      <span>{sample ? sampleNote || "Example content only · refresh Admin capture for saved app data" : `Captured ${formatCapturedAt(snapshot?.captured_at)} · static until Admin refresh`}</span>
    </div>
  );
}

function IndexPicker({ index, setIndex }) {
  return (
    <label className="mb-3 block max-w-xs text-[10px] font-semibold uppercase tracking-wide text-slate-500">
      Index
      <select
        aria-label="Preview index"
        value={index}
        onChange={(event) => setIndex(event.target.value)}
        className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs font-medium text-slate-800"
      >
        {INDICES.map((value) => <option key={value} value={value}>{value}</option>)}
      </select>
    </label>
  );
}

function RawStrikeTable({ current, previous }) {
  const previousByStrike = new Map((previous?.strikes || []).map((row) => [row.strike, row]));
  return (
    <div className="max-h-[390px] overflow-auto rounded-xl border border-slate-200 bg-white">
      <table className="w-full min-w-[34rem] text-[11px]">
        <thead className="sticky top-0 bg-slate-50 text-[9px] uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-3 py-2 text-right">Strike</th>
            <th className="px-3 py-2 text-right">Call OI</th>
            <th className="px-3 py-2 text-right">Call ΔOI</th>
            <th className="px-3 py-2 text-right">Put OI</th>
            <th className="px-3 py-2 text-right">Put ΔOI</th>
          </tr>
        </thead>
        <tbody>{current.strikes.map((row) => {
          const before = previousByStrike.get(row.strike);
          return (
            <tr key={row.strike} className={`border-t border-slate-100 ${row.strike === current.atm ? "bg-emerald-50 font-semibold" : ""}`}>
              <td className="px-3 py-2 text-right font-mono">{formatNumber(row.strike, 0)}</td>
              <td className="px-3 py-2 text-right font-mono">{formatNumber(row.ce_oi, 0)}</td>
              <td className="px-3 py-2 text-right font-mono">{before ? formatNumber(Number(row.ce_oi || 0) - Number(before.ce_oi || 0), 0) : "—"}</td>
              <td className="px-3 py-2 text-right font-mono">{formatNumber(row.pe_oi, 0)}</td>
              <td className="px-3 py-2 text-right font-mono">{before ? formatNumber(Number(row.pe_oi || 0) - Number(before.pe_oi || 0), 0) : "—"}</td>
            </tr>
          );
        })}</tbody>
      </table>
    </div>
  );
}

function BuildupPreview({ current, previous, atm }) {
  const rows = classifyBuildups({ current, previous });
  if (!rows.length) return <Unavailable>The saved capture does not contain a comparable previous snapshot for this build-up preview.</Unavailable>;
  return (
    <div className="max-h-[390px] overflow-auto rounded-xl border border-slate-200 bg-white" data-testid="buildup-preview">
      <p className="border-b border-slate-100 bg-slate-50 px-3 py-2 text-[10px] leading-4 text-slate-600">
        Compare observed call/put OI and option-price changes by strike. The public preview shows measurements only, without directional labels or trade guidance.
      </p>
      <table className="w-full min-w-[34rem] text-[11px]">
        <thead className="sticky top-0 bg-white text-[9px] uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-3 py-2 text-right">Strike</th>
            <th className="px-3 py-2 text-right">Call ΔOI</th>
            <th className="px-3 py-2 text-right">Call ΔPrice</th>
            <th className="px-3 py-2 text-right">Put ΔOI</th>
            <th className="px-3 py-2 text-right">Put ΔPrice</th>
          </tr>
        </thead>
        <tbody>{rows.map((row) => (
          <tr key={row.strike} className={`border-t border-slate-100 ${row.strike === atm ? "bg-amber-50 font-semibold" : ""}`}>
            <td className="px-3 py-2 text-right font-mono">{formatNumber(row.strike, 0)}</td>
            <td className="px-3 py-2 text-right font-mono">{formatNumber(row.ce_oi_pct)}%</td>
            <td className="px-3 py-2 text-right font-mono">{formatNumber(row.ce_ltp_pct)}%</td>
            <td className="px-3 py-2 text-right font-mono">{formatNumber(row.pe_oi_pct)}%</td>
            <td className="px-3 py-2 text-right font-mono">{formatNumber(row.pe_ltp_pct)}%</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function OiSnapshot({ featureId, snapshot }) {
  const [index, setIndex] = useState("NIFTY");
  const source = snapshot?.indices?.[index]?.oi_change;
  const hasCapturedData = Boolean(source?.current?.strikes?.length);
  const sample = makeSampleOi(index);
  const current = hasCapturedData ? source.current : sample.current;
  const previous = hasCapturedData ? source.previous : sample.previous;
  const dataStatus = source?.data_status?.label || "Captured";
  const timeframeLabel = `${source?.data_status?.window_minutes || 15} min`;

  return (
    <div>
      <CaptureStamp snapshot={snapshot} label={`Shared publisher OI · ${dataStatus}`} sample={!hasCapturedData} />
      <IndexPicker index={index} setIndex={setIndex} />
      <div className="mb-3 grid gap-2 sm:grid-cols-3">
        <div className="rounded-lg border border-slate-200 bg-white p-3"><span className="text-[9px] font-semibold uppercase text-slate-500">Spot</span><b className="mt-1 block text-sm text-slate-900">{formatNumber(current.price ?? current.atm, 2)}</b></div>
        <div className="rounded-lg border border-slate-200 bg-white p-3"><span className="text-[9px] font-semibold uppercase text-slate-500">ATM</span><b className="mt-1 block text-sm text-slate-900">{formatNumber(current.atm, 0)}</b></div>
        <div className="rounded-lg border border-slate-200 bg-white p-3"><span className="text-[9px] font-semibold uppercase text-slate-500">Window</span><b className="mt-1 block text-sm text-slate-900">{featureId === "oi_change" ? timeframeLabel : hasCapturedData ? "Captured distribution" : "Sample distribution"}</b></div>
      </div>
      {featureId === "strike_table" ? (
        <RawStrikeTable current={current} previous={previous} />
      ) : featureId === "buildup" ? (
        <BuildupPreview current={current} previous={previous} atm={current.atm} />
      ) : (
        <LandingOiChart
          current={current}
          previous={previous}
          featureId={featureId}
          sample={!hasCapturedData}
        />
      )}
      <p className="mt-2 text-[10px] leading-4 text-slate-500">{hasCapturedData ? "Read-only saved publisher data." : "Illustrative sample values only; not live market data."} This preview does not include a subscriber&apos;s broker positions.</p>
    </div>
  );
}

function StraddleSnapshot({ snapshot }) {
  const [index, setIndex] = useState("NIFTY");
  const source = snapshot?.indices?.[index]?.straddle;
  const hasCapturedData = source?.status === "captured" && (source.data?.history || []).length >= 2;
  const history = hasCapturedData ? source.data.history : SAMPLE_STRADDLE.history;
  const rows = history.map((point) => ({
    ...point,
    chartTime: point.ts ? new Date(point.ts).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" }) : "",
    chartPremium: Number(point.premium ?? (Number(point.ce_ltp || 0) + Number(point.pe_ltp || 0))),
  })).filter((point) => Number.isFinite(point.chartPremium) && point.chartPremium > 0);
  return (
    <div>
      <CaptureStamp snapshot={snapshot} label="Publisher ATM straddle history" sample={!hasCapturedData} />
      <IndexPicker index={index} setIndex={setIndex} />
      {!rows.length ? <Unavailable>The sample straddle points could not be displayed.</Unavailable> : (
        <>
          <div className="h-64 rounded-xl border border-slate-200 bg-white p-2">
            <div className="px-2 pt-1 text-[10px] text-slate-500">{hasCapturedData ? `Captured ATM straddle premium · ${source.data.trade_date || "trade date unavailable"}` : "Illustrative ATM straddle premium · not live market data"}</div>
            <ResponsiveContainer width="100%" height="90%">
              <LineChart data={rows} margin={{ top: 8, right: 8, bottom: 4, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="chartTime" tick={{ fontSize: 9 }} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 9 }} width={38} />
                <Tooltip formatter={(value) => [`₹${formatNumber(value)}`, "Premium"]} />
                <Line dataKey="chartPremium" name="Premium" stroke="#0f766e" strokeWidth={2} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-2 text-[10px] leading-4 text-slate-500">{hasCapturedData ? "Only points returned by the app at capture time are shown." : "Illustrative sample points only; refresh Admin capture for saved publisher data."}</p>
        </>
      )}
    </div>
  );
}

function eventRows(indexData) {
  const events = indexData?.events?.data?.events;
  return Array.isArray(events) ? events : [];
}

function EventsSnapshot({ featureId, snapshot }) {
  const [index, setIndex] = useState("NIFTY");
  const [view, setView] = useState(featureId === "events" ? "holidays" : "events");
  const capturedHolidays = snapshot?.holidays?.data?.holidays || [];
  const holidays = capturedHolidays.length ? capturedHolidays : upcomingHolidays();
  const eventsSource = snapshot?.indices?.[index]?.events;
  const capturedEvents = eventRows(snapshot?.indices?.[index]);
  const events = capturedEvents.length ? capturedEvents : SAMPLE_EVENTS.filter((item) => item.index === index);
  const items = view === "holidays"
    ? holidays
    : events.map((item) => ({
        ...item,
        date: item.event_date || item.date,
        name: item.company_name || item.company || item.symbol || "Constituent",
        title: item.event_type || item.title || "Market event",
        note: [
          item.index || index,
          item.days_remaining != null ? `${item.days_remaining} days remaining` : "",
          item.weightage != null ? `Index weight ${formatNumber(item.weightage)}%` : "",
        ].filter(Boolean).join(" · "),
      }));
  const sample = view === "holidays"
    ? snapshot?.holidays?.status !== "captured" || capturedHolidays.length === 0
    : eventsSource?.status !== "captured" || capturedEvents.length === 0;
  const builtInHolidayCalendar = view === "holidays" && capturedHolidays.length === 0;
  const upcoming = items.filter((item) => item.days_remaining != null && Number.isFinite(Number(item.days_remaining)));
  const nearestEvent = upcoming.reduce((nearest, item) => (
    !nearest || Number(item.days_remaining) < Number(nearest.days_remaining) ? item : nearest
  ), null);
  const largestListedWeight = items.reduce((largest, item) => (
    item.weightage != null
      && Number.isFinite(Number(item.weightage))
      && (!largest || Number(item.weightage) > Number(largest.weightage))
      ? item
      : largest
  ), null);

  return (
    <div>
      <CaptureStamp
        snapshot={snapshot}
        label={featureId === "index_risk" ? "Captured index event context" : "Captured app calendar data"}
        sample={sample}
        sampleLabel={builtInHolidayCalendar ? "Built-in NSE holiday calendar" : undefined}
        sampleNote={builtInHolidayCalendar ? "Actual app calendar dates · confirm exchange circulars" : undefined}
      />
      {view !== "holidays" && <IndexPicker index={index} setIndex={setIndex} />}
      {featureId === "index_risk" ? (
        <>
          <div className="mb-3 rounded-xl border border-indigo-100 bg-indigo-50/70 p-3" data-testid="index-risk-summary">
            <div className="text-xs font-bold text-indigo-950">{index} · upcoming event context</div>
            <p className="mt-1 text-[10px] leading-4 text-indigo-900">Review scheduled dates, event type, days remaining, and any listed constituent weight. This is calendar context, not a risk score or trade instruction.</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              <div className="rounded-lg border border-indigo-100 bg-white p-2"><span className="block text-[9px] font-semibold uppercase text-slate-500">Listed events</span><b className="mt-1 block text-sm text-slate-900">{items.length}</b></div>
              <div className="rounded-lg border border-indigo-100 bg-white p-2"><span className="block text-[9px] font-semibold uppercase text-slate-500">Nearest event</span><b className="mt-1 block truncate text-[11px] text-slate-900">{nearestEvent?.title || "No date supplied"}</b></div>
              <div className="rounded-lg border border-indigo-100 bg-white p-2"><span className="block text-[9px] font-semibold uppercase text-slate-500">Largest listed weight</span><b className="mt-1 block text-sm text-slate-900">{largestListedWeight?.weightage == null ? "Not supplied" : `${formatNumber(largestListedWeight.weightage)}%`}</b></div>
            </div>
          </div>
          <div className="mb-3 text-[10px] font-bold uppercase tracking-wide text-slate-500">Event calendar · {sample ? "illustrative entries" : "captured entries"}</div>
        </>
      ) : (
        <div className="mb-3 flex gap-2">
          {["events", "holidays"].map((kind) => (
            <button key={kind} type="button" aria-pressed={view === kind} onClick={() => setView(kind)} className={`rounded-full px-3 py-1.5 text-xs font-semibold ${view === kind ? "bg-emerald-700 text-white" : "border border-slate-200 bg-white text-slate-600"}`}>
              {kind === "events" ? "Index events" : "Trading holidays"}
            </button>
          ))}
        </div>
      )}
      {!items.length ? <Unavailable>The calendar preview could not display its saved or app-calendar entries.</Unavailable> : (
        <div className="grid max-h-[330px] gap-2 overflow-y-auto md:grid-cols-2">
          {items.slice(0, 60).map((item, itemIndex) => (
            <article key={`${item.date}-${item.title || item.name}-${itemIndex}`} data-testid={featureId === "index_risk" ? "index-risk-event" : undefined} className="rounded-xl border border-slate-200 bg-white p-3">
              <div className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-500"><CalendarDays className="h-3.5 w-3.5" />{item.date || "Date not supplied"}{item.session ? ` · ${item.session}` : ""}</div>
              <h5 className="mt-2 text-xs font-bold text-slate-900">{item.name || item.title}</h5>
              {item.title && item.name && <p className="mt-1 text-[11px] font-medium text-slate-700">{item.title}</p>}
              {item.note && <p className="mt-1 text-[10px] leading-4 text-slate-500">{item.note}</p>}
              {featureId === "index_risk" && sample && <p className="mt-2 inline-flex rounded-full bg-amber-50 px-2 py-1 text-[9px] font-semibold text-amber-800">Illustrative event · not live</p>}
              {item.open && item.close && <p className="mt-1 text-[10px] text-slate-500">Special session · {item.open}–{item.close}</p>}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function MarketIntelSnapshot({ snapshot }) {
  const capturedItems = snapshot?.market_intel?.data?.items || [];
  const hasCapturedData = snapshot?.market_intel?.status === "captured" && capturedItems.length > 0;
  const items = hasCapturedData ? capturedItems : SAMPLE_MARKET_INTEL;
  const [selected, setSelected] = useState(0);
  const item = items[selected];
  if (!item) return <Unavailable>The Market Intel preview could not display its stories.</Unavailable>;
  const title = item.title || item.headline || item.event_title || "Untitled Market Intel story";
  const summary = item.india_impact || item.india_impact_summary || item.summary || item.description || item.impact || "";
  return (
    <div>
      <CaptureStamp snapshot={snapshot} label="Captured Market Intel stories" sample={!hasCapturedData} />
      <div className="grid max-h-[360px] gap-3 overflow-y-auto md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="space-y-2">
          {items.slice(0, 40).map((story, index) => (
            <button key={story.id || story.cluster_id || story.title || index} type="button" onClick={() => setSelected(index)} aria-pressed={selected === index} className={`w-full rounded-xl border p-3 text-left ${selected === index ? "border-indigo-300 bg-indigo-50" : "border-slate-200 bg-white"}`}>
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase text-slate-500"><Newspaper className="h-3 w-3" />Market Intel</span>
              <span className="mt-1 block text-xs font-bold text-slate-800">{story.title || story.headline || "Market Intel story"}</span>
            </button>
          ))}
        </div>
        <article className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-[10px] font-bold uppercase tracking-wide text-indigo-700">Market Intel{item.published_at ? ` · ${item.published_at}` : ""}</div>
          <h5 className="mt-2 text-sm font-bold text-slate-900">{title}</h5>
          <p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-slate-600">{summary || "The captured story has no summary field."}</p>
          {(item.direction || item.volatility || item.importance) && (
            <div className="mt-3 grid grid-cols-2 gap-2">
              {["direction", "volatility", "importance"].filter((key) => item[key]).map((key) => <div key={key} className="rounded-lg bg-slate-50 p-2"><span className="block text-[9px] font-semibold uppercase text-slate-500">{key.replace("_", " ")}</span><span className="mt-1 block text-xs font-bold text-slate-800">{String(item[key])}</span></div>)}
            </div>
          )}
        </article>
      </div>
    </div>
  );
}

function GlobalMarketsSnapshot({ snapshot }) {
  const source = snapshot?.global_markets;
  const data = source?.data;
  const capturedItems = data?.items || EMPTY_ITEMS;
  const hasCapturedData = source?.status === "captured" && data?.enabled !== false && capturedItems.length > 0;
  const items = hasCapturedData ? capturedItems : SAMPLE_GLOBAL_MARKETS;
  const categories = hasCapturedData ? data?.categories || [] : ["India reference", "Global indices", "ADRs"];
  const [category, setCategory] = useState("all");
  const categoryOptions = [...new Set(categories.map((value) => (
    typeof value === "string" ? value : value?.name || value?.id
  )).filter(Boolean))];
  const filtered = useMemo(() => {
    if (category === "all") return items;
    return items.filter((item) => item.category === category);
  }, [items, category]);
  return (
    <div>
      <CaptureStamp snapshot={snapshot} label="Captured Global Markets reference data" sample={!hasCapturedData} />
      {categoryOptions.length > 0 && (
        <label className="mb-3 block max-w-xs text-[10px] font-semibold uppercase tracking-wide text-slate-500">
          Market group
          <select aria-label="Global market group" value={category} onChange={(event) => setCategory(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs font-medium text-slate-800">
            <option value="all">All groups</option>
            {categoryOptions.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
      )}
      {!filtered.length ? <Unavailable>The Global Markets preview has no instruments in this group.</Unavailable> : (
        <div className="max-h-[360px] overflow-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full min-w-[34rem] text-[11px]">
            <thead className="bg-slate-50 text-[9px] uppercase tracking-wide text-slate-500"><tr><th className="px-3 py-2 text-left">Instrument</th><th className="px-3 py-2 text-right">Last</th><th className="px-3 py-2 text-right">Change</th><th className="px-3 py-2 text-right">Change %</th><th className="px-3 py-2 text-left">Status</th></tr></thead>
            <tbody>{filtered.slice(0, 40).map((item) => (
              <tr key={item.id || item.symbol} className="border-t border-slate-100">
                <td className="px-3 py-2"><b>{item.symbol || item.id || "Instrument"}</b><div className="text-[10px] text-slate-500">{item.displayName || item.category || ""}</div></td>
                <td className="px-3 py-2 text-right font-mono">{formatNumber(item.price)}</td>
                <td className="px-3 py-2 text-right font-mono">{formatNumber(item.change)}</td>
                <td className="px-3 py-2 text-right font-mono">{item.changePercent == null ? "—" : `${formatNumber(item.changePercent)}%`}</td>
                <td className="px-3 py-2">{item.available ? item.marketStatus || "Available" : item.stale ? "Unavailable" : item.marketStatus || "Pending"}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ActivitySnapshot({ snapshot }) {
  const source = snapshot?.activity;
  const capturedItems = source?.data?.items || [];
  const hasCapturedData = source?.status === "captured" && capturedItems.length > 0;
  const items = hasCapturedData ? capturedItems : SAMPLE_ACTIVITY;
  const [index, setIndex] = useState("all");
  const indices = [...new Set(items.map((item) => item.index).filter(Boolean))];
  const shown = index === "all" ? items : items.filter((item) => item.index === index);
  return (
    <div>
      <CaptureStamp snapshot={snapshot} label="Shared publisher OI alert tape" sample={!hasCapturedData} />
      <p className="mb-3 text-xs leading-5 text-slate-600">{hasCapturedData ? "This is the publisher desk's shared OI alert tape captured by Admin." : "Illustrative alert examples show how the shared publisher OI activity feed is organized; these are not live alerts."} It never includes a subscriber&apos;s personal alert preferences or inbox state.</p>
      {!items.length ? <Unavailable>The activity preview could not display its saved or sample entries.</Unavailable> : (
        <>
          <label className="mb-3 block max-w-xs text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            Index
            <select aria-label="Activity index filter" value={index} onChange={(event) => setIndex(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs font-medium text-slate-800">
              <option value="all">All indices</option>
              {indices.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <div className="space-y-2">
          {shown.map((item) => (
            <div key={item.id} className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-3">
              <Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
              <div><div className="text-xs font-bold text-slate-900">{item.title}</div><div className="mt-1 text-[10px] text-slate-500">{item.index} · {!item.at && !hasCapturedData ? "Illustrative example" : formatCapturedAt(item.at)}</div>{item.detail && <div className="mt-1 text-[11px] text-slate-600">{item.detail}</div>}</div>
            </div>
          ))}
          </div>
        </>
      )}
    </div>
  );
}

export default function CapturedPlanPreview({ featureId, snapshot }) {
  if (["oi_change", "open_interest", "strike_table", "buildup", "writer_defense", "chart_signal_chips", "sell_candidates", "suggestion_window"].includes(featureId)) {
    return <OiSnapshot featureId={featureId} snapshot={snapshot} />;
  }
  if (featureId === "straddle") return <StraddleSnapshot snapshot={snapshot} />;
  if (["events", "index_risk"].includes(featureId)) return <EventsSnapshot featureId={featureId} snapshot={snapshot} />;
  if (featureId === "market_intel") return <MarketIntelSnapshot snapshot={snapshot} />;
  if (featureId === "global_markets") return <GlobalMarketsSnapshot snapshot={snapshot} />;
  if (featureId === "activity") return <ActivitySnapshot snapshot={snapshot} />;
  return <Unavailable><Globe2 className="mr-1 inline h-3.5 w-3.5" />No captured-data preview is implemented for this feature.</Unavailable>;
}
