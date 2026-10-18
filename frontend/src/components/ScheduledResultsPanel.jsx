function eventDateLabel(value) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    timeZone: "Asia/Kolkata",
  }).format(parsed);
}

function checkedDateLabel(value) {
  const date = eventDateLabel(value);
  return date ? ` · calendar updated ${date}` : "";
}

export default function ScheduledResultsPanel({
  results = [],
  calendarStatus,
  calendarAsOf,
  scheduleDate,
  testId = "scheduled-results",
}) {
  const visibleResults = results.slice(0, 3);
  const matchingCount = results.filter(
    (result) => result.news_status === "RESULTS_NEWS_FOUND",
  ).length;

  return (
    <section className="mt-2 border-t border-slate-100 pt-2" data-testid={testId}>
      <div className="flex flex-wrap items-center justify-between gap-1">
        <h4 className="text-[10px] font-semibold text-slate-700">
          Results scheduled{eventDateLabel(scheduleDate) ? ` · ${eventDateLabel(scheduleDate)}` : ""}
        </h4>
        {results.length ? (
          <span className="text-[9px] text-slate-500">
            {matchingCount}/{results.length} with result news
          </span>
        ) : null}
      </div>
      {calendarStatus === "NO_DATA" ? (
        <p className="mt-1 text-[10px] text-amber-700">
          NSE event calendar unavailable; scheduled results for this date cannot be confirmed.
        </p>
      ) : calendarStatus === "STALE" ? (
        <p className="mt-1 text-[10px] text-amber-700">
          NSE event calendar may be outdated
          {checkedDateLabel(calendarAsOf)}.
        </p>
      ) : null}
      {visibleResults.length ? (
        <ul className="mt-1 space-y-1.5">
          {visibleResults.map((result) => (
            <ScheduledResultRow key={result.symbol || result.company_name} result={result} />
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-[10px] text-slate-500">
          {calendarStatus === "CURRENT"
            ? "No quarterly results listed for this index on this date."
            : "Scheduled results cannot be confirmed for this date."}
        </p>
      )}
      {results.length > visibleResults.length ? (
        <details className="mt-1 text-[10px] text-slate-500" data-testid={`${testId}-more`}>
          <summary className="w-fit cursor-pointer font-medium text-slate-600">
            Show {results.length - visibleResults.length} more
          </summary>
          <ul className="mt-1 space-y-1.5">
            {results.slice(visibleResults.length).map((result) => (
              <ScheduledResultRow key={result.symbol || result.company_name} result={result} />
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

function ScheduledResultRow({ result }) {
  const statusText = {
    RESULTS_NEWS_FOUND: "Results news found",
    COMPANY_NEWS_ONLY: "Company news only",
    NO_MATCHING_NEWS: "No matching news found",
  }[result.news_status] || "News match unavailable";
  const statusClass = result.news_status === "RESULTS_NEWS_FOUND"
    ? "text-emerald-700"
    : result.news_status === "NO_MATCHING_NEWS"
      ? "text-amber-700"
      : "text-slate-500";
  const story = result.stories?.[0];
  return (
    <li className="text-[10px] leading-snug" data-testid="scheduled-result-row">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2">
        <span className="font-medium text-slate-700">{result.company_name}</span>
        <span className={statusClass}>{statusText}</span>
      </div>
      <p className="text-slate-400">
        {result.symbol}{result.weightage != null ? ` · ${Number(result.weightage).toFixed(2)}% index weight` : ""}
      </p>
      {story ? (
        story.article_url ? (
          <a href={story.article_url} target="_blank" rel="noreferrer" className="block text-slate-600 underline decoration-slate-300 hover:text-emerald-800">
            {story.title}
          </a>
        ) : <p className="text-slate-600">{story.title}</p>
      ) : result.news_status === "NO_MATCHING_NEWS" ? (
        <p className="text-slate-400">This does not confirm that results were not published.</p>
      ) : null}
    </li>
  );
}
