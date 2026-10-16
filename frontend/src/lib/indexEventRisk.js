/**
 * Index Impact / Upcoming Index Event Risk helpers.
 * Backend join lives in event_risk_service; the tile and widget only show
 * events with days_remaining >= 0 (past calendar rows stay in the API payload).
 */

export function upcomingIndexEvents(events) {
  return (events || [])
    .filter((e) => (e.days_remaining ?? -1) >= 0)
    .sort(
      (a, b) =>
        a.days_remaining - b.days_remaining ||
        -((a.weightage || 0) - (b.weightage || 0)),
    );
}

export function impactTone(upcoming) {
  if (!upcoming?.length) return "neutral";
  if (upcoming.some((e) => e.days_remaining <= 7)) return "red";
  if (upcoming.some((e) => e.days_remaining > 7 && e.days_remaining <= 14)) return "blue";
  return "neutral";
}

export function eventDisplayName(e, activeIndex) {
  if (!e) return "";
  if (activeIndex === "SENSEX") {
    return e.constituents || e.company_name || e.symbol || "";
  }
  return e.symbol || e.company_name || "";
}

export function daysText(d) {
  if (d === 0) return "TODAY";
  if (d === 1) return "TOMORROW";
  return `in ${d}d`;
}

export function weightageBucket(w) {
  if (w == null) return "grey";
  if (w > 5) return "dark-red";
  if (w >= 3) return "red";
  if (w >= 1) return "orange";
  return "yellow";
}

export function eventHighlightBucket(event) {
  return event?.days_remaining <= 7 && weightageBucket(event?.weightage) === "dark-red"
    ? "dark-red"
    : "grey";
}

export function eventContextLabel(event) {
  const days = event?.days_remaining;
  const timing = days === 0
    ? "Today"
    : days === 1
      ? "Tomorrow"
      : `In ${days} days`;
  const weightLabel = {
    "dark-red": "Index weight >5%",
    red: "Index weight 3–5%",
    orange: "Index weight 1–3%",
    yellow: "Index weight <1%",
    grey: "Index weight unavailable",
  }[weightageBucket(event?.weightage)];
  return `${timing} · ${weightLabel}`;
}

export function filterIndexEvents(events, { withinDays = "all", eventType = "all" } = {}) {
  return (events || []).filter((event) => {
    const isUpcoming = event.days_remaining >= 0;
    const matchesWindow = withinDays === "all" || event.days_remaining <= Number(withinDays);
    const matchesType = eventType === "all" || event.event_type === eventType;
    return isUpcoming && matchesWindow && matchesType;
  });
}
