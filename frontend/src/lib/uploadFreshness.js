/**
 * Upload freshness rules for Index Risk / Admin advisories.
 *
 * NSE event calendar should be refreshed about twice a month so mid-month
 * corporate events are not missed. Index constituents change less often.
 */
export const UPLOAD_FRESHNESS = {
  events: {
    key: "events",
    label: "NSE event calendar",
    shortLabel: "NSE events",
    staleAfterDays: 15,
    advice:
      "Fetch the latest three-month NSE calendar or upload its CSV manually. Reusing this file does not extend its event dates.",
  },
  holidays: {
    key: "holidays",
    label: "NSE holiday circular",
    shortLabel: "NSE holidays",
    staleAfterDays: 365,
    advice:
      "Upload the latest NSE trading-holiday circular when it is published, or confirm the existing calendar if it remains current.",
  },
  nifty50: {
    key: "nifty50",
    label: "Nifty 50 constituents",
    shortLabel: "Nifty 50",
    staleAfterDays: 30,
    advice: "If the current file is still valid, confirm it in Admin → Upload to keep using it; otherwise upload the latest constituents.",
  },
  banknifty: {
    key: "banknifty",
    label: "Bank Nifty constituents",
    shortLabel: "Bank Nifty",
    staleAfterDays: 30,
    advice: "If the current file is still valid, confirm it in Admin → Upload to keep using it; otherwise upload the latest constituents.",
  },
  sensex: {
    key: "sensex",
    label: "Sensex constituents",
    shortLabel: "Sensex",
    staleAfterDays: 30,
    advice: "If the current file is still valid, confirm it in Admin → Upload to keep using it; otherwise upload the latest constituents.",
  },
};

export const UPLOAD_ORDER = ["nifty50", "banknifty", "sensex", "events", "holidays"];

export function uploadAgeDays(uploadedAt, now = new Date()) {
  if (!uploadedAt) return null;
  try {
    const d = new Date(uploadedAt);
    if (Number.isNaN(d.getTime())) return null;
    const ms = now.getTime() - d.getTime();
    if (ms < 0) return 0;
    return Math.floor(ms / (24 * 60 * 60 * 1000));
  } catch {
    return null;
  }
}

export function uploadFreshnessTimestamp(meta) {
  return meta?.confirmed_at || meta?.uploaded_at || null;
}

export function isUploadStale(key, uploadedAt, now = new Date()) {
  const rule = UPLOAD_FRESHNESS[key];
  if (!rule) return false;
  const age = uploadAgeDays(uploadedAt, now);
  if (age == null) return true; // never uploaded
  return age >= rule.staleAfterDays;
}

/**
 * @returns {Array<{ key, label, shortLabel, staleAfterDays, advice, uploadedAt, ageDays, stale, never }>}
 */
export function evaluateUploadFreshness(meta, now = new Date()) {
  return UPLOAD_ORDER.map((key) => {
    const rule = UPLOAD_FRESHNESS[key];
    const row = meta?.[key] || {};
    const uploadedAt = uploadFreshnessTimestamp(row);
    const ageDays = uploadAgeDays(uploadedAt, now);
    const never = !uploadedAt;
    const stale = never || (ageDays != null && ageDays >= rule.staleAfterDays);
    return {
      key,
      label: rule.label,
      shortLabel: rule.shortLabel,
      staleAfterDays: rule.staleAfterDays,
      advice: rule.advice,
      uploadedAt,
      originalUploadedAt: row.uploaded_at || null,
      confirmedAt: row.confirmed_at || null,
      sourceFilename: row.source_filename || null,
      ageDays,
      never,
      stale,
    };
  });
}

export function formatUploadAge(ageDays, never) {
  if (never || ageDays == null) return "never uploaded";
  if (ageDays === 0) return "uploaded today";
  if (ageDays === 1) return "1 day old";
  return `${ageDays} days old`;
}
