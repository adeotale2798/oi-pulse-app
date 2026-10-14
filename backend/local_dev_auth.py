"""Parsing and verification for explicitly configured local member test accounts."""

import hmac
import json


_PLANS = {"normal", "premium", "pro"}


def parse_local_test_users(raw, app_env):
    """Read local test credentials only in development, rejecting ambiguous config."""
    if str(app_env or "").strip().lower() != "development" or not str(raw or "").strip():
        return {}
    if len(raw) > 8192:
        raise ValueError("LOCAL_DEV_MEMBER_USERS is too large")
    try:
        entries = json.loads(raw)
    except (TypeError, ValueError) as exc:
        raise ValueError("LOCAL_DEV_MEMBER_USERS must be a JSON array") from exc
    if not isinstance(entries, list):
        raise ValueError("LOCAL_DEV_MEMBER_USERS must be a JSON array")

    users = {}
    for entry in entries:
        if not isinstance(entry, dict):
            raise ValueError("Each local test account must be an object")
        email = str(entry.get("email") or "").strip().lower()
        password = entry.get("password")
        plan = str(entry.get("plan") or "").strip().lower()
        if (
            not email
            or "@" not in email
            or not isinstance(password, str)
            or not password
            or plan not in _PLANS
        ):
            raise ValueError("Each local test account needs a valid email, password, and plan")
        if email in users:
            raise ValueError("LOCAL_DEV_MEMBER_USERS contains a duplicate email")
        users[email] = {"password": password, "plan": plan}
    return users


def local_test_password_matches(provided, expected):
    """Compare local test passwords without an early-exit string comparison."""
    if not isinstance(provided, str) or not isinstance(expected, str):
        return False
    return hmac.compare_digest(provided.encode("utf-8"), expected.encode("utf-8"))
