/** Public/admin dashboard page ticks. Home is always OI Change until /config arrives. */

export const HOME_PAGE = "oi-change";
export const BOOT_VISIBLE_PAGES = [HOME_PAGE];
// Stale public settings must never grant Admin-only recommendation surfaces.
const ADMIN_ONLY_PAGE_IDS = new Set(["sell-candidates"]);

/**
 * Before pagesReady, only HOME_PAGE is allowed so a reload cannot flash
 * Straddle / CAS / ADRs / etc. to guests.
 */
export function pageAllowed(id, { isAdmin, visiblePages, adminPages, pagesReady = true } = {}) {
  if (ADMIN_ONLY_PAGE_IDS.has(id) && !isAdmin) return false;
  if (pagesReady === false) return id === HOME_PAGE;
  if (isAdmin) {
    if (!Array.isArray(adminPages) || adminPages.length === 0) return true;
    return adminPages.includes(id);
  }
  return Array.isArray(visiblePages) && visiblePages.includes(id);
}

export function memberFeatureAllowed(feature, { isMember, features } = {}) {
  if (!isMember) return true;
  return Boolean(feature && Array.isArray(features) && features.includes(feature));
}

export function sanitizePageList(ids, fallback = BOOT_VISIBLE_PAGES, includeAdminOnly = false) {
  const source = Array.isArray(ids) && ids.length ? ids : fallback;
  const pages = source
    .map((id) => String(id || "").trim())
    .filter((id) => id && (includeAdminOnly || !ADMIN_ONLY_PAGE_IDS.has(id)));
  return pages.length
    ? pages
    : fallback.filter((id) => id && (includeAdminOnly || !ADMIN_ONLY_PAGE_IDS.has(id)));
}
