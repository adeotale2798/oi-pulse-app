import { useEffect, useMemo, useState } from "react";
import { fetchIndexEvents } from "@/lib/indexEventsApi";
import { Calendar, AlertTriangle, TrendingUp, Users, Building2, Clock, ChevronDown, ChevronUp, X } from "lucide-react";
import {
  eventDisplayName,
  eventContextLabel,
  eventHighlightBucket,
  filterIndexEvents,
  weightageBucket,
} from "@/lib/indexEventRisk";

const DISMISS_LS_KEY = "oi_event_risk_dismissed";

function loadDismissed() {
  try {
    return localStorage.getItem(DISMISS_LS_KEY) === "1";
  } catch {
    return false;
  }
}

function saveDismissed(on) {
  try {
    localStorage.setItem(DISMISS_LS_KEY, on ? "1" : "0");
  } catch { /* noop */ }
}

/**
 * EventRiskWidget — scheduled events for the current strategy page (activeIndex).
 *
 * Event categories use soft color accents for quick scanning; near-term,
 * high-weight events retain the stronger urgency highlight.
 */

const INDEX_LABEL = {
  NIFTY: "NIFTY 50",
  BANKNIFTY: "Bank Nifty",
  SENSEX: "Sensex",
};

const BUCKET_STYLES = {
  // Weight bands drive the color so identical stakes look the same across event types.
  "dark-red": {
    card:  "border border-rose-200 border-l-2 border-l-rose-400 bg-rose-50/70 text-slate-900 dark:border-rose-900 dark:border-l-rose-500 dark:bg-rose-950/25 dark:text-slate-100",
    chip:  "border-rose-200 border-l-2 border-l-rose-400 bg-rose-50 text-rose-950 dark:border-rose-900 dark:border-l-rose-500 dark:bg-rose-950/35 dark:text-rose-100",
    dot:   "bg-rose-400",
    badge: "text-rose-700 dark:text-rose-300",
    label: ">5% weight",
  },
  red: {
    card:  "border border-orange-200 border-l-2 border-l-orange-400 bg-orange-50/70 text-slate-900 dark:border-orange-900 dark:border-l-orange-500 dark:bg-orange-950/25 dark:text-slate-100",
    chip:  "border-orange-200 border-l-2 border-l-orange-400 bg-orange-50 text-orange-950 dark:border-orange-900 dark:border-l-orange-500 dark:bg-orange-950/35 dark:text-orange-100",
    dot:   "bg-orange-400",
    badge: "text-orange-700 dark:text-orange-300",
    label: "3–5% weight",
  },
  orange: {
    card:  "border border-amber-200 border-l-2 border-l-amber-400 bg-amber-50/70 text-slate-900 dark:border-amber-900 dark:border-l-amber-500 dark:bg-amber-950/25 dark:text-slate-100",
    chip:  "border-amber-200 border-l-2 border-l-amber-400 bg-amber-50 text-amber-950 dark:border-amber-900 dark:border-l-amber-500 dark:bg-amber-950/35 dark:text-amber-100",
    dot:   "bg-amber-400",
    badge: "text-amber-700 dark:text-amber-300",
    label: "1–3% weight",
  },
  yellow: {
    card:  "border border-yellow-200 border-l-2 border-l-yellow-400 bg-yellow-50/70 text-slate-900 dark:border-yellow-900 dark:border-l-yellow-500 dark:bg-yellow-950/25 dark:text-slate-100",
    chip:  "border-yellow-200 border-l-2 border-l-yellow-400 bg-yellow-50 text-yellow-950 dark:border-yellow-900 dark:border-l-yellow-500 dark:bg-yellow-950/35 dark:text-yellow-100",
    dot:   "bg-yellow-400",
    badge: "text-yellow-700 dark:text-yellow-300",
    label: "<1% weight",
  },
  grey: {
    card:  "border border-slate-200 border-l-2 border-l-slate-300 bg-slate-50/70 text-slate-900 dark:border-slate-700 dark:border-l-slate-500 dark:bg-slate-800/70 dark:text-slate-100",
    chip:  "border-slate-200 border-l-2 border-l-slate-300 bg-slate-50 text-slate-700 dark:border-slate-700 dark:border-l-slate-500 dark:bg-slate-800/70 dark:text-slate-200",
    dot:   "bg-slate-400",
    badge: "text-slate-500 dark:text-slate-400",
    label: "Weight unavailable",
  },
};

const URGENT_HIGH_WEIGHT_STYLE = {
  card: "border border-rose-300 border-l-4 border-l-rose-600 bg-rose-100/80 text-slate-900 dark:border-rose-800 dark:border-l-rose-400 dark:bg-rose-950/45 dark:text-slate-100",
  chip: "border-rose-300 border-l-4 border-l-rose-600 bg-rose-100 text-rose-950 dark:border-rose-800 dark:border-l-rose-400 dark:bg-rose-950/50 dark:text-rose-100",
  badge: "text-rose-800 dark:text-rose-300",
  label: "High index share",
};

function eventVisualStyle(event) {
  const bucket = weightageBucket(event?.weightage);
  if (bucket === "dark-red" && event?.days_remaining <= 7) {
    return { ...BUCKET_STYLES[bucket], ...URGENT_HIGH_WEIGHT_STYLE };
  }
  return BUCKET_STYLES[bucket];
}

function formatDate(iso) {
  try {
    const d = new Date(iso + "T00:00:00");
    return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
  } catch (_) { return iso; }
}

function daysLeftText(n) {
  if (n === 0) return "Today";
  if (n === 1) return "Tomorrow";
  if (n < 0) return `${Math.abs(n)}d ago`;
  return `${n}d left`;
}

export default function EventRiskWidget({
  activeIndex,
  refreshKey = 0,
  isAdmin = false,
  allowDismiss = true,
}) {
  const [events, setEvents] = useState([]);
  const [joinInfo, setJoinInfo] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [showAll, setShowAll] = useState(false);
  const [showTimeline, setShowTimeline] = useState(false);
  const [eventWindow, setEventWindow] = useState("all");
  const [eventTypeFilter, setEventTypeFilter] = useState("all");
  const [dismissed, setDismissed] = useState(() => loadDismissed());

  useEffect(() => {
    if (!activeIndex) return;
    let cancelled = false;
    setLoading(true); setErr(null);
    fetchIndexEvents(activeIndex, { includeJoin: isAdmin, force: refreshKey > 0 })
      .then((data) => {
        if (cancelled) return;
        setEvents(data.events || []);
        setJoinInfo(data.join || null);
      })
      .catch((e) => { if (!cancelled) setErr(e?.response?.data?.detail || e.message || "Failed to load events"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [activeIndex, refreshKey, isAdmin]);

  // ---- Derived data ----
  const upcoming = useMemo(() => events.filter((e) => e.days_remaining >= 0), [events]);
  const pastOnly = events.length > 0 && upcoming.length === 0;
  const next7 = useMemo(() => upcoming.filter((e) => e.days_remaining <= 7), [upcoming]);
  const eventTypes = useMemo(
    () => [...new Set(upcoming.map((event) => event.event_type).filter(Boolean))].sort(),
    [upcoming],
  );
  const filteredUpcoming = useMemo(
    () => filterIndexEvents(upcoming, { withinDays: eventWindow, eventType: eventTypeFilter }),
    [upcoming, eventWindow, eventTypeFilter],
  );

  const summary = useMemo(() => {
    const results = upcoming.filter((e) => e.event_type === "Quarterly Results").length;
    const board = upcoming.filter((e) => e.event_type === "Board Meeting").length;
    const highest = [...upcoming]
      .filter((e) => e.weightage != null)
      .sort((a, b) => (b.weightage || 0) - (a.weightage || 0))[0] || null;
    const nextEvent = [...upcoming]
      .sort((a, b) => a.days_remaining - b.days_remaining)[0] || null;
    return {
      results,
      board,
      next7Count: next7.length,
      highest,
      nextEvent,
    };
  }, [upcoming, next7]);

  const timeline = useMemo(() => {
    const groups = {};
    upcoming.forEach((e) => {
      const k = e.event_date;
      if (!groups[k]) groups[k] = [];
      groups[k].push(e);
    });
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
  }, [upcoming]);

  const label = INDEX_LABEL[activeIndex] || activeIndex;
  if (allowDismiss && dismissed) {
    return (
      <div
        data-testid="event-risk-widget-dismissed"
        className="mt-1 border border-dashed border-slate-200 dark:border-slate-700 rounded-md bg-slate-50/80 dark:bg-slate-900/40 px-3 py-2 flex items-center justify-between gap-2"
      >
        <span className="text-xs text-slate-500">Upcoming Index Event Risk hidden</span>
        <button
          type="button"
          data-testid="event-risk-show-again"
          className="text-[11px] font-semibold text-sky-700 hover:text-sky-900 dark:text-sky-300"
          onClick={() => {
            setDismissed(false);
            saveDismissed(false);
          }}
        >
          Show again
        </button>
      </div>
    );
  }

  return (
    <div
      data-testid="event-risk-widget"
      className="mt-1 border border-slate-200 dark:border-slate-700 rounded-md bg-white dark:bg-slate-900 shadow-sm"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-100 dark:border-slate-800">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-500" />
          <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">
            Upcoming Index Event Risk
          </span>
          <span className="text-[10px] uppercase tracking-widest text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 rounded px-1.5 py-0.5">
            {label}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="text-[11px] text-slate-500 dark:text-slate-400">
            {loading ? "Loading…" : err ? <span className="text-rose-500">{err}</span> : `${upcoming.length} upcoming`}
          </div>
          {allowDismiss ? (
          <button
            type="button"
            data-testid="event-risk-dismiss"
            title="Hide Index Event Risk"
            className="inline-flex items-center justify-center w-6 h-6 rounded-sm text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
            onClick={() => {
              setDismissed(true);
              saveDismissed(true);
            }}
          >
            <X className="w-3.5 h-3.5" />
          </button>
          ) : null}
        </div>
      </div>

      {isAdmin && joinInfo && joinInfo.constituent_count > 0 && (
        <div
          className="px-3 py-1.5 border-b border-slate-100 dark:border-slate-800 text-[11px] text-slate-600 dark:text-slate-300"
          data-testid="event-join-coverage"
        >
          Events file matched {joinInfo.constituents_with_event}/{joinInfo.constituent_count} {label} names
          {joinInfo.near_misses?.length
            ? ` · ${joinInfo.near_misses.length} NSE row(s) look close but did not join (${joinInfo.near_misses.slice(0, 4).map((n) => n.event_symbol || n.event_company).join(", ")})`
            : " · no leftover close-matches"}
          .
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-5 gap-2 p-3 border-b border-slate-100 dark:border-slate-800">
        <SummaryCard icon={TrendingUp} label="Upcoming Results" value={summary.results} tone="sky" />
        <SummaryCard icon={Users} label="Board Meetings" value={summary.board} tone="violet" />
        <SummaryCard icon={Clock} label="Next 7 Days" value={summary.next7Count} tone="amber" />
        <SummaryCard
          icon={Building2}
          label="Highest Index-Weight Upcoming Company"
          value={
            summary.highest
              ? eventDisplayName(summary.highest, activeIndex)
              : "—"
          }
          sub={
            summary.highest
              ? `${summary.highest.weightage?.toFixed(2)}% index share`
              : ""
          }
          tone={weightageBucket(summary.highest?.weightage)}
        />
        <SummaryCard
          icon={Calendar}
          label="Next Upcoming"
          value={
            summary.nextEvent
              ? eventDisplayName(summary.nextEvent, activeIndex)
              : "—"
          }
          sub={summary.nextEvent ? daysLeftText(summary.nextEvent.days_remaining) : ""}
          tone={weightageBucket(summary.nextEvent?.weightage)}
        />
      </div>

      {/* Upcoming 7-day risk */}
      {next7.length > 0 && (
        <div className="px-3 pt-3">
          <div className="text-[10px] uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-2">
            Upcoming 7-Day Event Risk
          </div>
          <div className="flex gap-2 flex-wrap">
            {next7.slice(0, 12).map((e) => (
              <EventChip key={e.id} ev={e} activeIndex={activeIndex} compact />
            ))}
          </div>
          <p className="mt-1.5 text-[10px] text-slate-500 dark:text-slate-400">
            Timing is when the event is scheduled. Index-weight bands show index share only; they do not predict event impact.
          </p>
        </div>
        )}

        {/* Full events tile grid */}
        <div className="p-3">
        {upcoming.length === 0 && !loading && !err && (
          <p className="text-xs text-slate-500 text-center py-6" data-testid="event-risk-empty">
            {pastOnly
              ? `All joined events for ${label} are dated before today.`
              : `There are no upcoming events for ${label}.`}
            {isAdmin
              ? pastOnly
                ? " Upload a fresh NSE event calendar in Admin."
                : " Upload the NSE event calendar and this index’s constituents in Admin if the list should not be empty."
              : " The board fills in after the desk uploads the event calendar."}
          </p>
        )}
        {upcoming.length > 0 && (
          <>
            <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2 mb-2">
              <div>
                <div className="text-[10px] uppercase tracking-widest text-slate-500 dark:text-slate-400">
                  All Upcoming Events (Sorted by Priority)
                </div>
                <p className="mt-0.5 text-[10px] text-slate-500 dark:text-slate-400">
                  Weight is the company’s share of this index, not a forecast of price impact.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <label className="flex items-center gap-1.5 text-[10px] text-slate-500 dark:text-slate-400">
                  <span>Window</span>
                  <select
                    data-testid="event-window-filter"
                    value={eventWindow}
                    onChange={(event) => { setEventWindow(event.target.value); setShowAll(false); }}
                    className="rounded border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                  >
                    <option value="all">All upcoming</option>
                    <option value="7">Next 7 days</option>
                    <option value="30">Next 30 days</option>
                  </select>
                </label>
                <label className="flex items-center gap-1.5 text-[10px] text-slate-500 dark:text-slate-400">
                  <span>Type</span>
                  <select
                    data-testid="event-type-filter"
                    value={eventTypeFilter}
                    onChange={(event) => { setEventTypeFilter(event.target.value); setShowAll(false); }}
                    className="max-w-[180px] rounded border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                  >
                    <option value="all">All event types</option>
                    {eventTypes.map((type) => <option key={type} value={type}>{type}</option>)}
                  </select>
                </label>
              </div>
            </div>
            {filteredUpcoming.length === 0 ? (
              <p className="py-5 text-center text-xs text-slate-500 dark:text-slate-400" data-testid="event-risk-filter-empty">
                No upcoming events match these filters.
              </p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {(showAll ? filteredUpcoming : filteredUpcoming.slice(0, 9)).map((e) => (
                  <EventCard key={e.id} ev={e} />
                ))}
              </div>
            )}
            {filteredUpcoming.length > 9 && (
              <button
                data-testid="events-show-more"
                onClick={() => setShowAll((v) => !v)}
                className="mt-2 text-[11px] text-slate-500 dark:text-slate-400 hover:text-slate-800 flex items-center gap-1"
              >
                {showAll ? <><ChevronUp className="w-3 h-3" /> Show less</> : <><ChevronDown className="w-3 h-3" /> Show all ({filteredUpcoming.length})</>}
              </button>
            )}
          </>
        )}
      </div>

      {/* Monthly timeline */}
      {timeline.length > 0 && (
        <div className="border-t border-slate-100 dark:border-slate-800 px-3 py-2">
          <button
            data-testid="events-timeline-toggle"
            onClick={() => setShowTimeline((v) => !v)}
            className="text-[11px] text-slate-500 dark:text-slate-400 hover:text-slate-800 flex items-center gap-1"
          >
            {showTimeline ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            Monthly Timeline ({timeline.length} dates)
          </button>
          {showTimeline && (
            <div className="mt-2 space-y-2 max-h-64 overflow-auto pr-1">
              {timeline.map(([date, evs]) => (
                <div key={date}>
                  <div className="text-[11px] font-semibold text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded">
                    {formatDate(date)} ({evs.length})
                  </div>
                  <ul className="pl-2 mt-1 space-y-0.5">
                    {evs.map((e) => (
                      <li key={e.id} className="text-[11px] text-slate-600 dark:text-slate-300 flex items-center gap-2">
                        <span className={`inline-block w-2 h-2 rounded-full ${BUCKET_STYLES[eventHighlightBucket(e)].dot}`} />
                        <span className="font-medium">{e.symbol}</span>
                        <span className="text-slate-400">·</span>
                        <span>{e.event_type}</span>
                        {e.weightage != null && (
                          <span className="text-slate-400 ml-auto">{e.weightage.toFixed(2)}%</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const SUMMARY_CARD_STYLES = {
  sky: "border-sky-200 bg-sky-50/80 dark:border-sky-900 dark:bg-sky-950/30",
  violet: "border-violet-200 bg-violet-50/80 dark:border-violet-900 dark:bg-violet-950/30",
  amber: "border-amber-200 bg-amber-50/80 dark:border-amber-900 dark:bg-amber-950/30",
  "dark-red": "border-rose-200 bg-rose-50/80 dark:border-rose-900 dark:bg-rose-950/30",
  red: "border-orange-200 bg-orange-50/80 dark:border-orange-900 dark:bg-orange-950/30",
  orange: "border-amber-200 bg-amber-50/80 dark:border-amber-900 dark:bg-amber-950/30",
  yellow: "border-yellow-200 bg-yellow-50/80 dark:border-yellow-900 dark:bg-yellow-950/30",
  grey: "border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/50",
};

const SUMMARY_ICON_STYLES = {
  sky: "text-sky-700 dark:text-sky-300",
  violet: "text-violet-700 dark:text-violet-300",
  amber: "text-amber-700 dark:text-amber-300",
  "dark-red": "text-rose-700 dark:text-rose-300",
  red: "text-orange-700 dark:text-orange-300",
  orange: "text-amber-700 dark:text-amber-300",
  yellow: "text-yellow-700 dark:text-yellow-300",
  grey: "text-slate-600 dark:text-slate-400",
};

function SummaryCard({ icon: Icon, label, value, sub, tone }) {
  return (
    <div className={`rounded-md border p-2 ${SUMMARY_CARD_STYLES[tone] || "border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/50"}`}>
      <div className={`flex items-center gap-1 text-[10px] uppercase tracking-widest ${SUMMARY_ICON_STYLES[tone] || "text-slate-600 dark:text-slate-400"}`}>
        <Icon className="w-3 h-3" />
        {label}
      </div>
      <div className="text-base font-semibold mt-0.5 text-slate-800 dark:text-slate-100">{value ?? "—"}</div>
      {sub && <div className="text-[10px] text-slate-500 dark:text-slate-400">{sub}</div>}
    </div>
  );
}

function EventChip({ ev, activeIndex }) {
  const s = eventVisualStyle(ev);
  return (
    <div
      data-testid={`event-chip-${ev.symbol}`}
      className={`rounded-md border px-2 py-1 ${s.chip} shadow-sm`}
      title={`${ev.company_name} — ${ev.event_type} on ${formatDate(ev.event_date)}`}
    >
      <div className="flex items-center gap-1.5">
        <span className="text-[11px] font-bold">
          {eventDisplayName(ev, activeIndex)}
        </span>
        {ev.weightage != null ? (
          <span className="text-[10px] opacity-90">{ev.weightage.toFixed(2)}%</span>
        ) : (
          <span className="text-[10px] opacity-70">N/A</span>
        )}
      </div>
      <div className="text-[10px] leading-tight">
        {ev.event_type}
      </div>
      <div className="text-[10px] leading-tight opacity-90">
        {eventContextLabel(ev)}
      </div>
    </div>
  );
}

function EventCard({ ev }) {
  const s = eventVisualStyle(ev);
  return (
    <div
      data-testid={`event-card-${ev.symbol}`}
      className={`rounded-md p-2.5 shadow-sm ${s.card}`}
      title={ev.details || ev.purpose_raw}
    >
      <div className="flex items-start justify-between gap-1">
        <div className="min-w-0">
          <div className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate">{ev.company_name}</div>
          <div className="text-[10px] font-mono text-slate-500 dark:text-slate-400">{ev.symbol}</div>
        </div>
        <div className="text-right shrink-0">
          <div className={`text-xs font-bold ${s.badge}`}>
            {ev.weightage != null ? `${ev.weightage.toFixed(2)}%` : "N/A"}
          </div>
          <div className={`text-[9px] uppercase tracking-widest font-semibold ${s.badge}`}>
            {s.label}
          </div>
        </div>
      </div>
      <div className="mt-1.5 pt-1.5 border-t border-slate-100 dark:border-slate-700">
        <div className="text-[11px] font-medium text-slate-700 dark:text-slate-200">{ev.event_type}</div>
        <div className="text-[10px] text-slate-500 dark:text-slate-400 flex items-center justify-between mt-0.5">
          <span>{formatDate(ev.event_date)}</span>
          <span className={`font-semibold ${s.badge}`}>{eventContextLabel(ev)}</span>
        </div>
      </div>
    </div>
  );
}