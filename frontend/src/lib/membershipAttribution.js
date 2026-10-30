const STORAGE_KEY = "oi_membership_attribution";
const CAMPAIGN_FIELDS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"];

function cleanLabel(value) {
  if (typeof value !== "string") return "";
  return [...value]
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code >= 32 && code !== 127;
    })
    .join("")
    .trim()
    .slice(0, 100);
}

function resolveStorage(storage) {
  if (storage) return storage;
  if (typeof window !== "undefined") return window.sessionStorage;
  return null;
}

export function readMembershipAttribution(storage) {
  try {
    const raw = resolveStorage(storage)?.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      [...CAMPAIGN_FIELDS, "referrer"].flatMap((field) => {
        const value = cleanLabel(parsed[field]);
        return value ? [[field, value]] : [];
      }),
    );
  } catch (_) {
    return {};
  }
}

export function captureMembershipAttribution(search, referrer, currentHost, storage) {
  try {
    const sessionStorage = resolveStorage(storage);
    if (!sessionStorage) return {};
    const existing = sessionStorage.getItem(STORAGE_KEY);
    if (existing) return readMembershipAttribution(sessionStorage);

    const params = new URLSearchParams(search || "");
    const attribution = {};
    CAMPAIGN_FIELDS.forEach((field) => {
      const value = cleanLabel(params.get(field));
      if (value) attribution[field] = value;
    });

    if (referrer) {
      try {
        const parsed = new URL(referrer);
        if (
          ["http:", "https:"].includes(parsed.protocol)
          && parsed.hostname
          && parsed.hostname.toLowerCase() !== String(currentHost || "").toLowerCase()
        ) {
          attribution.referrer = parsed.origin;
        }
      } catch (_) {
        // A malformed referrer must not discard valid campaign labels.
      }
    }

    if (Object.keys(attribution).length) {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(attribution));
    }
    return attribution;
  } catch (_) {
    return {};
  }
}

export function clearMembershipAttribution(storage) {
  try {
    resolveStorage(storage)?.removeItem(STORAGE_KEY);
  } catch (_) {
    // Attribution is optional; storage failure must not block sign-in.
  }
}
