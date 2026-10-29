import { api } from "@/lib/api";

const CACHE_TTL_MS = 15_000;
const cache = new Map();
const inflight = new Map();

export function clearIndexEventsCache() {
  cache.clear();
  inflight.clear();
}

export function fetchIndexEvents(index, { includeJoin = false, force = false } = {}) {
  const normalizedIndex = String(index || "").trim().toUpperCase();
  if (!normalizedIndex) return Promise.reject(new Error("An index is required to load events"));
  // Admin responses contain join diagnostics; keep them out of the public cache.
  const key = `${normalizedIndex}:${includeJoin ? "admin" : "public"}`;
  const cached = cache.get(key);
  if (!force && cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return Promise.resolve(cached.data);
  }
  if (force) cache.delete(key);
  if (inflight.has(key)) return inflight.get(key);

  const request = api.get(`/events/${normalizedIndex}`).then(({ data }) => {
    if (!data || !Array.isArray(data.events)) {
      throw new Error("Index events response was invalid");
    }
    const result = includeJoin ? data : { ...data, join: null };
    if (!includeJoin) {
      delete result.events_source_filename;
      delete result.constituents_source_filename;
    }
    cache.set(key, { data: result, fetchedAt: Date.now() });
    return result;
  }).finally(() => {
    if (inflight.get(key) === request) inflight.delete(key);
  });
  inflight.set(key, request);
  return request;
}
