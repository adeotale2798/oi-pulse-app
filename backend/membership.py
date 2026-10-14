"""Member plan defaults and safe normalization for admin-managed entitlements."""

from copy import deepcopy
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo


PLAN_NAMES = ("normal", "premium", "pro")

PLAN_FEATURES = {
    "oi_change": "OI Change",
    "open_interest": "Open Interest",
    "strike_table": "Strike Table",
    "buildup": "Build-up",
    "straddle": "Straddle",
    "index_risk": "Index Risk",
    "events": "Events calendar",
    "activity": "Activity feed",
    "alerts": "Alerts inbox",
    "alert_sounds": "Alert sound preferences",
    "market_intel": "Market Intel",
    "global_markets": "Global Markets",
    "overnight_position_risk": "Overnight position risk",
    "oi_shift_alerts": "OI shift alerts",
    "oi_change_alerts": "OI change alerts",
    "event_alerts": "Event alerts",
    "positions": "Positions",
    "trade_journal": "Trade Journal",
    "desk_ai": "Desk AI",
}

_NORMAL_FEATURES = (
    "oi_change", "open_interest", "strike_table", "buildup", "straddle",
    "index_risk", "events", "activity",
)
_PREMIUM_FEATURES = _NORMAL_FEATURES + (
    "alerts", "alert_sounds", "market_intel", "global_markets",
    "oi_shift_alerts", "oi_change_alerts", "event_alerts",
)
_PRO_FEATURES = _PREMIUM_FEATURES + (
    "overnight_position_risk", "positions", "trade_journal",
    "desk_ai",
)

_FEATURE_CEILINGS = {
    "normal": set(_NORMAL_FEATURES) | {"alert_sounds"},
    "premium": set(_PREMIUM_FEATURES),
    "pro": set(PLAN_FEATURES),
}

DEFAULT_MEMBERSHIP = {
    "experience_enabled": False,
    "signup_enabled": False,
    "paid_subscriptions_enabled": False,
    "plans": {
        "normal": {"enabled": True, "features": list(_NORMAL_FEATURES)},
        "premium": {"enabled": True, "features": list(_PREMIUM_FEATURES)},
        "pro": {"enabled": True, "features": list(_PRO_FEATURES)},
    },
    "early_access": {
        "enabled": False,
        "discount_percent": 0,
    },
    "preference_defaults": {
        "alert_indices": ["NIFTY", "SENSEX", "BANKNIFTY"],
        "oi_change_threshold_pct": 15,
        "alert_cooldown_seconds": 300,
        "alert_types": {
            "oi_change": True,
            "oi_shift": True,
            "market_intel": True,
            "event": True,
        },
        "oi_shift_threshold_contracts": 100000,
        "trade_cycle_persistence_enabled": False,
        "show_writer_defense": False,
        "show_suggestion": False,
        "show_chart_signals": False,
        "overnight_position_risk_enabled": True,
    },
}

IST = ZoneInfo("Asia/Kolkata")
MEMBER_DASHBOARD_PAGE_IDS = {
    "oi-change", "open-interest", "strike-table", "buildup",
    "positions", "alerts", "activity", "holidays", "straddle", "index-events",
    "cas", "market-intel", "adrs",
}
DEFAULT_MEMBER_PREFERENCES = {
    "alert_indices": ["NIFTY", "SENSEX", "BANKNIFTY"],
    "oi_change_threshold_pct": 15,
    "alert_cooldown_seconds": 300,
    "alert_types": {
        "oi_change": True,
        "oi_shift": True,
        "market_intel": True,
        "event": True,
    },
    "oi_shift_threshold_contracts": 100000,
    "trade_cycle_persistence_enabled": False,
    "show_writer_defense": False,
    "show_suggestion": False,
    "show_chart_signals": False,
    "overnight_position_risk_enabled": True,
    "hidden_dashboard_pages": [],
}


def normalize_membership(raw):
    """Keep only supported member controls; admin-only poll/MCX settings stay separate."""
    result = deepcopy(DEFAULT_MEMBERSHIP)
    if not isinstance(raw, dict):
        return result

    for key in ("experience_enabled", "signup_enabled", "paid_subscriptions_enabled"):
        if key in raw:
            result[key] = bool(raw[key])

    plans = raw.get("plans")
    if isinstance(plans, dict):
        for plan_name in PLAN_NAMES:
            configured = plans.get(plan_name)
            if not isinstance(configured, dict):
                continue
            if "enabled" in configured:
                result["plans"][plan_name]["enabled"] = bool(configured["enabled"])
            features = configured.get("features")
            if isinstance(features, list):
                result["plans"][plan_name]["features"] = list(dict.fromkeys(
                    feature for feature in features
                    if isinstance(feature, str)
                    and feature in _FEATURE_CEILINGS[plan_name]
                ))

    early_access = raw.get("early_access")
    if isinstance(early_access, dict):
        if "enabled" in early_access:
            result["early_access"]["enabled"] = bool(early_access["enabled"])
        if "discount_percent" in early_access:
            try:
                discount = int(early_access["discount_percent"])
            except (TypeError, ValueError):
                discount = 0
            result["early_access"]["discount_percent"] = min(100, max(0, discount))

    prefs = raw.get("preference_defaults")
    if isinstance(prefs, dict):
        indices = prefs.get("alert_indices")
        if isinstance(indices, list):
            allowed = {"NIFTY", "SENSEX", "BANKNIFTY"}
            result["preference_defaults"]["alert_indices"] = list(dict.fromkeys(
                index for index in indices
                if isinstance(index, str) and index in allowed
            ))
        try:
            threshold = float(prefs.get("oi_change_threshold_pct",
                                       result["preference_defaults"]["oi_change_threshold_pct"]))
        except (TypeError, ValueError):
            threshold = result["preference_defaults"]["oi_change_threshold_pct"]
        result["preference_defaults"]["oi_change_threshold_pct"] = min(100, max(1, threshold))
        try:
            cooldown = int(prefs.get("alert_cooldown_seconds",
                                     result["preference_defaults"]["alert_cooldown_seconds"]))
        except (TypeError, ValueError):
            cooldown = result["preference_defaults"]["alert_cooldown_seconds"]
        result["preference_defaults"]["alert_cooldown_seconds"] = min(3600, max(30, cooldown))
        raw_types = prefs.get("alert_types")
        if isinstance(raw_types, dict):
            result["preference_defaults"]["alert_types"] = {
                key: bool(raw_types.get(key, default))
                for key, default in result["preference_defaults"]["alert_types"].items()
            }
        try:
            shift_threshold = int(prefs.get(
                "oi_shift_threshold_contracts",
                result["preference_defaults"]["oi_shift_threshold_contracts"],
            ))
        except (TypeError, ValueError):
            shift_threshold = result["preference_defaults"]["oi_shift_threshold_contracts"]
        result["preference_defaults"]["oi_shift_threshold_contracts"] = min(
            100_000_000, max(1, shift_threshold)
        )
        result["preference_defaults"]["trade_cycle_persistence_enabled"] = bool(
            prefs.get(
                "trade_cycle_persistence_enabled",
                result["preference_defaults"]["trade_cycle_persistence_enabled"],
            )
        )
        for key in ("show_writer_defense", "show_suggestion", "show_chart_signals"):
            result["preference_defaults"][key] = False
        for key in ("overnight_position_risk_enabled",):
            result["preference_defaults"][key] = bool(
                prefs.get(key, result["preference_defaults"][key])
            )

    return result


def normalize_member_preferences(raw, defaults=None):
    """Normalize only private, non-broker preferences; saving cycles is opt-in."""
    result = deepcopy(DEFAULT_MEMBER_PREFERENCES)
    if isinstance(defaults, dict):
        result.update(defaults)
    if not isinstance(raw, dict):
        return result

    allowed = {"NIFTY", "SENSEX", "BANKNIFTY"}
    indices = raw.get("alert_indices")
    if isinstance(indices, list):
        result["alert_indices"] = list(dict.fromkeys(
            index for index in indices if isinstance(index, str) and index in allowed
        ))
    try:
        threshold = float(raw.get("oi_change_threshold_pct", result["oi_change_threshold_pct"]))
    except (TypeError, ValueError):
        threshold = result["oi_change_threshold_pct"]
    result["oi_change_threshold_pct"] = min(100, max(1, threshold))
    try:
        cooldown = int(raw.get("alert_cooldown_seconds", result["alert_cooldown_seconds"]))
    except (TypeError, ValueError):
        cooldown = result["alert_cooldown_seconds"]
    result["alert_cooldown_seconds"] = min(3600, max(30, cooldown))
    raw_types = raw.get("alert_types")
    if isinstance(raw_types, dict):
        result["alert_types"] = {
            key: bool(raw_types.get(key, default))
            for key, default in result["alert_types"].items()
        }
    try:
        shift_threshold = int(raw.get(
            "oi_shift_threshold_contracts",
            result["oi_shift_threshold_contracts"],
        ))
    except (TypeError, ValueError):
        shift_threshold = result["oi_shift_threshold_contracts"]
    result["oi_shift_threshold_contracts"] = min(100_000_000, max(1, shift_threshold))
    result["trade_cycle_persistence_enabled"] = bool(
        raw.get("trade_cycle_persistence_enabled", result["trade_cycle_persistence_enabled"])
    )
    # These switches enable trade recommendations; member preferences cannot
    # re-enable surfaces reserved for the Admin desk.
    for key in ("show_writer_defense", "show_suggestion", "show_chart_signals"):
        result[key] = False
    for key in ("overnight_position_risk_enabled",):
        result[key] = bool(raw.get(key, result[key]))
    hidden_pages = raw.get("hidden_dashboard_pages")
    if isinstance(hidden_pages, list):
        result["hidden_dashboard_pages"] = list(dict.fromkeys(
            page_id for page_id in hidden_pages
            if isinstance(page_id, str) and page_id in MEMBER_DASHBOARD_PAGE_IDS
        ))
    return result


def plan_features(membership, plan_name):
    """Return the configured feature set for an enabled plan, otherwise no access."""
    config = normalize_membership(membership)
    plan = config["plans"].get(plan_name)
    if not plan or not plan["enabled"] or not config["experience_enabled"]:
        return set()
    return set(plan["features"])


def member_alert_purge_cutoff(now=None):
    """Return the most recent 09:00 IST boundary for alert history retention."""
    current = now or datetime.now(timezone.utc)
    if current.tzinfo is None:
        current = current.replace(tzinfo=timezone.utc)
    local = current.astimezone(IST)
    cutoff = local.replace(hour=9, minute=0, second=0, microsecond=0)
    if local < cutoff:
        cutoff -= timedelta(days=1)
    return cutoff.astimezone(timezone.utc)


def next_member_alert_purge(now=None):
    """Return the next 09:00 IST wall-clock boundary as an aware UTC instant."""
    current = now or datetime.now(timezone.utc)
    if current.tzinfo is None:
        current = current.replace(tzinfo=timezone.utc)
    local = current.astimezone(IST)
    target = local.replace(hour=9, minute=0, second=0, microsecond=0)
    if target <= local:
        target += timedelta(days=1)
    return target.astimezone(timezone.utc)
