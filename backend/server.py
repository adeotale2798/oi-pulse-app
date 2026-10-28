from fastapi import FastAPI, APIRouter, HTTPException, Query, Request, Depends
from fastapi import WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse, Response, StreamingResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
import os
import asyncio
import base64
import binascii
import gzip
import hashlib
import hmac
import json
import logging
import math
import re
import time
import tempfile
import ipaddress
from collections import defaultdict, deque
from pathlib import Path
from pydantic import BaseModel, ConfigDict, Field, field_validator
from typing import Annotated, Optional, List, Dict, Any, Literal
from datetime import datetime, timezone, timedelta, date

# Delay motor client creation until startup to avoid heavy connection objects during import.
from motor.motor_asyncio import AsyncIOMotorClient
from bson import json_util
from pymongo.errors import AutoReconnect, ServerSelectionTimeoutError

from app_version import APP_NAME, APP_VERSION, APP_VERSION_LABEL
from ws_close import close_ws_quietly, ws_client_gone
from error_log import bind as bind_error_log, install_logging_handler, record_error
from oi_lookup import prefer_newer_snapshot
from oi_tracker import OITracker, INDICES, JsonLogFormatter, resolve_desk_ai, DEFAULT_SETTINGS
from poll_intervals import (
    clamp_straddle_poll_seconds,
    clamp_oi_poll_seconds,
    clamp_positions_poll_seconds,
)
from oi_change_lookback import lookback_floor
from oi_service import INDEX_CONFIG
from universe import catalog_public, DESK_IDS
from vrp_service import compute_vrp
from market_hours import (
    is_market_open, IST, MARKET_OPEN, is_weekend, display_hours, configure_hours,
    session_anchor_date, session_window_utc, previous_trading_day, now_ist,
    is_special_session_day, is_full_holiday, session_poll_bounds,
    index_in_session, any_index_in_session,
    is_cas_iep_window, needs_index_quote_overlay, cas_iep_interval_seconds, configure_cas_iep, cas_iep_config,
)
from gift_vix_service import extra_tickers
from fii_dii_service import fii_dii
from guest_access import require_approval_flag
from local_dev_auth import local_test_password_matches, parse_local_test_users
import event_risk_service as ers
import trade_journal as journal
import trade_ledger as ledger
import desk_guide as desk_guide_svc
import desk_outside as desk_outside_svc
from fastapi import UploadFile, File, Form

# cryptography import deferred inside _fernet() to reduce startup import cost
import base64, hashlib

def _fernet():
    # Import inside function so cryptography is loaded only when vault operations are used.
    # Prefer dedicated CREDENTIALS_FERNET_KEY / OI_VAULT_KEY (Fernet key or passphrase).
    # Fallback keeps legacy Mongo-derived key so existing vault rows still decrypt.
    from cryptography.fernet import Fernet
    explicit = (os.environ.get("CREDENTIALS_FERNET_KEY") or os.environ.get("OI_VAULT_KEY") or "").strip()
    if explicit:
        try:
            return Fernet(explicit.encode() if isinstance(explicit, str) else explicit)
        except Exception:
            key = base64.urlsafe_b64encode(hashlib.sha256(explicit.encode()).digest())
            return Fernet(key)
    seed = os.environ.get("MONGO_URL", "seed") + os.environ.get("DB_NAME", "db")
    key = base64.urlsafe_b64encode(hashlib.sha256(seed.encode()).digest())
    return Fernet(key)

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')
APP_ENV = os.environ.get("APP_ENV", "production").strip().lower()
LOCAL_DEV_ADMIN_BYPASS_ENABLED = os.environ.get("LOCAL_DEV_ADMIN_BYPASS", "false").strip().lower() in {
    "1", "true", "yes", "on",
}
if LOCAL_DEV_ADMIN_BYPASS_ENABLED and APP_ENV != "development":
    raise RuntimeError("LOCAL_DEV_ADMIN_BYPASS is allowed only when APP_ENV=development")
try:
    LOCAL_DEV_MEMBER_USERS = parse_local_test_users(
        os.environ.get("LOCAL_DEV_MEMBER_USERS", ""),
        APP_ENV,
    )
except ValueError as exc:
    raise RuntimeError(str(exc)) from exc


def _local_dev_member_account_emails():
    plan_order = {"normal": 0, "premium": 1, "pro": 2}
    return sorted(
        LOCAL_DEV_MEMBER_USERS,
        key=lambda email: (plan_order[LOCAL_DEV_MEMBER_USERS[email]["plan"]], email),
    )


# Create Mongo client and db during startup event to keep import-time footprint low.
client = None
db = None

_docs_enabled = os.environ.get("API_DOCS_ENABLED", "false").strip().lower() == "true"
app = FastAPI(
    title=APP_NAME,
    docs_url="/docs" if _docs_enabled else None,
    redoc_url="/redoc" if _docs_enabled else None,
    openapi_url="/openapi.json" if _docs_enabled else None,
)
api_router = APIRouter(prefix="/api")


@app.exception_handler(Exception)
async def _unhandled_exception(request: Request, exc: Exception):
    from fastapi.exception_handlers import http_exception_handler, request_validation_exception_handler
    from fastapi.exceptions import RequestValidationError
    from starlette.exceptions import HTTPException as StarletteHTTPException

    if isinstance(exc, StarletteHTTPException):
        return await http_exception_handler(request, exc)
    if isinstance(exc, RequestValidationError):
        return await request_validation_exception_handler(request, exc)
    if isinstance(exc, WebSocketDisconnect) or type(exc).__name__ in (
        "WebSocketDisconnect",
        "ConnectionClosed",
        "ConnectionClosedOK",
        "ConnectionClosedError",
    ):
        return Response(status_code=1011)
    import traceback as _tb

    try:
        await record_error(
            source="api",
            message=str(exc) or type(exc).__name__,
            traceback_text=_tb.format_exc(),
            path=str(request.url.path or "")[:300],
            kind=type(exc).__name__,
        )
    except Exception:
        pass
    return JSONResponse({"detail": "Internal error"}, status_code=500)


@app.get("/health")
@app.get("/ready")
@app.get("/api/health")
async def k8s_health():
    """K8s / Emergent readiness — 200 as soon as uvicorn binds. No Kite/Yahoo/Mongo wait."""
    return {"ok": True, "name": APP_NAME, "version": APP_VERSION, "version_label": APP_VERSION_LABEL}

tracker = None


def _require_tracker():
    """Kite/OI tracker is created after Mongo boots; callers should fail before spending one-use tokens."""
    if tracker is None:
        raise HTTPException(
            status_code=503,
            detail="Desk is still starting (Mongo/OI tracker not ready). Wait a few seconds and try again.",
        )
    return tracker


def _live_settings() -> dict:
    if tracker and isinstance(getattr(tracker, "settings", None), dict):
        return tracker.settings
    return dict(DEFAULT_SETTINGS)


async def _get_sitewalkthrough_enabled() -> bool:
    if tracker and isinstance(getattr(tracker, "settings", None), dict):
        return bool(tracker.settings.get("sitewalkthrough_enabled", True))
    if db is None:
        return bool(DEFAULT_SETTINGS.get("sitewalkthrough_enabled", True))
    try:
        saved = await _find_one_capped(db.settings, {"_id": "alerts"}) or {}
    except Exception:
        logger.exception("Could not read persisted site walkthrough availability")
        return False
    return bool(saved.get(
        "sitewalkthrough_enabled",
        DEFAULT_SETTINGS.get("sitewalkthrough_enabled", True),
    ))


# Straddle sample retention (hours)
STRADDLE_RETENTION_HOURS = int(os.environ.get("STRADDLE_RETENTION_HOURS", "6"))
STRADDLE_INDICES = ["NIFTY", "SENSEX"]

# notifier DB will be attached during startup
import notifier as _notifier_boot


# ------------------- Auth helpers (must be defined before endpoints that Depends on them) -------------------
import secrets
import hmac

ADMIN_USERNAME = os.environ.get("ADMIN_USERNAME", "Adeotale")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "").strip()
ADMIN_TOKEN = os.environ.get("ADMIN_TOKEN", "").strip()
if not ADMIN_TOKEN and ADMIN_PASSWORD:
    ADMIN_TOKEN = hashlib.sha256(f"{ADMIN_USERNAME}:{ADMIN_PASSWORD}:oi-pulse".encode()).hexdigest()

# 8-hour idle timeout for admin sessions.
ADMIN_SESSION_TTL_SECONDS = int(os.environ.get("ADMIN_SESSION_TTL_SECONDS", str(8 * 3600)))
_trusted_proxy_ips = {
    item.strip()
    for item in os.environ.get("TRUSTED_PROXY_IPS", "").split(",")
    if item.strip()
}
# Guest sessions expire at next 06:00 IST (not a rolling hour TTL).
GUEST_DAILY_EXPIRY_HOUR_IST = int(os.environ.get("GUEST_DAILY_EXPIRY_HOUR_IST", "6"))
# Legacy env kept only as an absolute safety cap (default 36h).
GUEST_SESSION_TTL_SECONDS = int(os.environ.get("GUEST_SESSION_TTL_SECONDS", str(36 * 3600)))


def _next_6am_ist_utc(now_utc: Optional[datetime] = None) -> datetime:
    """Next 06:00 Asia/Kolkata as UTC. If already past today's 06:00, use tomorrow."""
    now = now_utc or datetime.now(timezone.utc)
    now_ist = now.astimezone(IST)
    target = now_ist.replace(
        hour=GUEST_DAILY_EXPIRY_HOUR_IST, minute=0, second=0, microsecond=0
    )
    if now_ist >= target:
        target = target + timedelta(days=1)
    return target.astimezone(timezone.utc)


def _guest_expiry_from_start(started: datetime) -> datetime:
    """First 06:00 IST strictly after session start (UTC-aware)."""
    if started.tzinfo is None:
        started = started.replace(tzinfo=timezone.utc)
    started_ist = started.astimezone(IST)
    target = started_ist.replace(
        hour=GUEST_DAILY_EXPIRY_HOUR_IST, minute=0, second=0, microsecond=0
    )
    if started_ist >= target:
        target = target + timedelta(days=1)
    return target.astimezone(timezone.utc)


def _guest_seconds_remaining(expires_at: datetime, now_utc: Optional[datetime] = None) -> int:
    now = now_utc or datetime.now(timezone.utc)
    return max(60, int((expires_at - now).total_seconds()))


BLOCKED_IP_MESSAGE = "Unable to process request at this moment"


def _pw_hash(password: str, salt: bytes, iterations: int = 600_000) -> str:
    """Deterministic salted password hash (PBKDF2-HMAC-SHA256)."""
    iters = max(120_000, int(iterations or 600_000))
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iters)
    return dk.hex()


async def _verify_admin_password(password: str) -> bool:
    """Check password against DB-stored hash if it exists, else env-provided override."""
    if db is None:
        raise HTTPException(503, "Database is unavailable. Please retry in a moment.")
    try:
        doc = await db.settings.find_one({"_id": "admin_credentials"})
    except (AutoReconnect, ServerSelectionTimeoutError) as exc:
        logger.error("Admin password lookup failed because MongoDB is unavailable: %s", exc)
        raise HTTPException(503, "Database is unavailable. Please retry in a moment.") from exc
    if doc and doc.get("password_hash") and doc.get("salt_hex"):
        salt = bytes.fromhex(doc["salt_hex"])
        iters = int(doc.get("pbkdf2_iters") or 120_000)
        return hmac.compare_digest(_pw_hash(password, salt, iters), doc["password_hash"])
    if ADMIN_PASSWORD:
        return hmac.compare_digest(password, ADMIN_PASSWORD)
    return False


async def _store_admin_password(new_password: str):
    salt = secrets.token_bytes(16)
    iters = 600_000
    await db.settings.update_one(
        {"_id": "admin_credentials"},
        {"$set": {
            "password_hash": _pw_hash(new_password, salt, iters),
            "salt_hex": salt.hex(),
            "pbkdf2_iters": iters,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }},
        upsert=True,
    )


def _extract_bearer(request: Request, header: str) -> str:
    tok = (request.headers.get(header) or "").strip()
    if tok:
        return tok
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        return auth[7:].strip()
    return ""


async def _find_one_capped(coll, query, timeout=2.0):
    """Mongo find_one that cannot pin the event loop when the cluster is stuck."""
    if coll is None:
        return None
    try:
        return await asyncio.wait_for(coll.find_one(query, maxTimeMS=1500), timeout=timeout)
    except TypeError:
        try:
            return await asyncio.wait_for(coll.find_one(query), timeout=timeout)
        except Exception:
            return None
    except Exception:
        return None


async def _admin_from_request(request: Request):
    if _is_local_dev_admin_bypass_request(request):
        return {
            "created_at": datetime.now(timezone.utc).isoformat(),
            "ttl_seconds": ADMIN_SESSION_TTL_SECONDS,
            "local_dev_admin_bypass": True,
        }
    tok = _extract_bearer(request, "x-admin-token")
    if not tok:
        return None
    sess = await _find_one_capped(db.admin_sessions, {"_id": tok})
    if not sess:
        return None
    try:
        created_at = datetime.fromisoformat(sess.get("created_at"))
    except Exception:
        return None
    ttl = sess.get("ttl_seconds") or ADMIN_SESSION_TTL_SECONDS
    try:
        if tracker and tracker.settings.get("admin_session_ttl_minutes"):
            ttl = max(60, int(tracker.settings["admin_session_ttl_minutes"]) * 60)
    except Exception:
        pass
    age = (datetime.now(timezone.utc) - created_at).total_seconds()
    if age > ttl:
        try:
            await db.admin_sessions.delete_one({"_id": tok})
        except Exception:
            pass
        return None
    # Optional cap: force auto-logout at configured market close (DEFAULT OFF).
    expire_on_close = False
    try:
        if tracker and "expire_admin_on_market_close" in tracker.settings:
            expire_on_close = bool(tracker.settings["expire_admin_on_market_close"])
    except Exception:
        pass
    if expire_on_close:
        market_exp = _session_market_expiry_utc(created_at)
        if datetime.now(timezone.utc) >= market_exp:
            try:
                await db.admin_sessions.delete_one({"_id": tok})
            except Exception:
                pass
            return None
    return sess


def _is_loopback_host(host: Optional[str]) -> bool:
    normalized = str(host or "").strip().lower().rstrip(".")
    if normalized == "localhost":
        return True
    try:
        return ipaddress.ip_address(normalized).is_loopback
    except ValueError:
        return False


def _is_local_dev_admin_bypass_request(request: Request) -> bool:
    """Permit passwordless admin only for explicitly enabled loopback development."""
    return bool(LOCAL_DEV_ADMIN_BYPASS_ENABLED and _is_local_dev_request(request))


def _is_local_dev_request(request: Request) -> bool:
    """Keep local test identities bound to development and loopback HTTP requests."""
    if APP_ENV != "development":
        return False
    client = request.client
    return bool(
        client
        and _is_loopback_host(client.host)
        and _is_loopback_host(request.url.hostname)
    )


def _session_market_expiry_utc(created_at_utc: datetime) -> datetime:
    """Expire admin session at today's configured market close (IST), or tomorrow if already past."""
    created_ist = created_at_utc.astimezone(IST)
    _, close_hm = display_hours()
    try:
        hh, mm = [int(x) for x in close_hm.split(":")[:2]]
    except Exception:
        hh, mm = 15, 40
    close_ist = created_ist.replace(hour=hh, minute=mm, second=0, microsecond=0)
    if created_ist >= close_ist:
        close_ist = close_ist + timedelta(days=1)
    return close_ist.astimezone(timezone.utc)


async def _is_admin_request(request: Request) -> bool:
    return (await _admin_from_request(request)) is not None


async def require_admin(request: Request):
    """FastAPI dependency: 401 unless authenticated or explicitly local-dev bypassed."""
    if not await _is_admin_request(request):
        raise HTTPException(401, "Admin only")
    return True


async def require_desk_user(request: Request):
    """Admin, approved guest, or durable Google member."""
    if await _is_admin_request(request):
        await _enforce_market_data_access(request, "admin")
        return "admin"
    member = await _member_session_from_request(request)
    if member:
        await _require_member_route_access(request)
        await _enforce_market_data_access(request, "member")
        return "guest"
    guest = await _guest_from_request(request)
    if guest:
        await _enforce_market_data_access(request, "guest")
        return "guest"
    raise HTTPException(401, "Sign in required")


MEMBER_SESSION_TTL_SECONDS = 30 * 24 * 60 * 60


def _member_session_storage_id(token: str) -> str:
    """Store only a one-way lookup key for the member's bearer token."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


async def _member_session_from_request(request: Optional[Request]):
    """Resolve durable Google member sessions independently of guest-door state."""
    if db is None or request is None:
        return None
    token = (
        _extract_bearer(request, "x-member-token")
        or _extract_bearer(request, "x-guest-token")
    )
    if not token:
        return None
    token_key = _member_session_storage_id(token)
    session = await _find_one_capped(
        db.member_sessions,
        {"_id": {"$in": [token_key, token]}},
    )
    if not session or session.get("revoked_at"):
        return None
    expires = session.get("expires_at")
    if isinstance(expires, str):
        try:
            expires = datetime.fromisoformat(expires)
        except ValueError:
            return None
    if not isinstance(expires, datetime):
        return None
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    now = datetime.now(timezone.utc)
    if now >= expires:
        return None
    member_id = session.get("user_id")
    if not member_id:
        return None
    member = await _find_one_capped(db.members, {"_id": member_id})
    if not member or member.get("disabled_at"):
        return None
    if member.get("local_dev_test_account"):
        local_email = str(member.get("email") or "").lower()
        if (
            not _is_local_dev_request(request)
            or local_email not in LOCAL_DEV_MEMBER_USERS
        ):
            return None
    try:
        last_seen = session.get("last_seen_at")
        if isinstance(last_seen, str):
            last_seen = datetime.fromisoformat(last_seen)
        if not isinstance(last_seen, datetime) or (now - last_seen).total_seconds() >= 60:
            await db.member_sessions.update_one(
                {"_id": session["_id"]},
                {"$set": {
                    "last_seen_at": now,
                    "expires_at": now + timedelta(seconds=MEMBER_SESSION_TTL_SECONDS),
                }},
            )
    except Exception:
        pass
    return {
        "_id": token,
        "name": member.get("name") or member.get("email") or "Member",
        "email": member.get("email"),
        "is_member": True,
        "member_id": member_id,
        "member": member,
        "started_at": session.get("started_at"),
        "expires_at": (now + timedelta(seconds=MEMBER_SESSION_TTL_SECONDS)).isoformat(),
    }


def _effective_member_plan(member: dict, now: Optional[datetime] = None) -> str:
    """Grant paid features only for a current subscription or explicit admin grant."""
    if not member or member.get("disabled_at"):
        return "normal"
    plan = str(member.get("plan") or "normal").lower()
    if plan not in ("normal", "premium", "pro"):
        return "normal"
    if plan == "normal" or member.get("admin_plan_override"):
        return plan
    subscription = member.get("subscription") or {}
    # Cancellation and payment/provider failure end paid entitlement immediately.
    if subscription.get("status") != "active":
        return "normal"
    current_end = subscription.get("current_end")
    if isinstance(current_end, (int, float)):
        current_end = datetime.fromtimestamp(current_end, timezone.utc)
    elif isinstance(current_end, str):
        try:
            current_end = datetime.fromisoformat(current_end)
        except ValueError:
            current_end = None
    if current_end is None:
        return "normal"
    if current_end is not None:
        if current_end.tzinfo is None:
            current_end = current_end.replace(tzinfo=timezone.utc)
        if current_end <= (now or datetime.now(timezone.utc)):
            return "normal"
    return plan


async def _record_member_audit(
    member_id: str,
    event_type: str,
    actor: str,
    details: Optional[dict] = None,
):
    if db is None:
        raise HTTPException(503, "Database unavailable")
    await db.member_audit.insert_one({
        "member_id": member_id,
        "event_type": event_type,
        "actor": actor,
        "details": details or {},
        "created_at": datetime.now(timezone.utc),
    })


async def _member_context(request: Request, feature: Optional[str] = None):
    """Require a member identity and, when requested, its currently entitled feature."""
    sess = await _member_session_from_request(request)
    if not sess:
        raise HTTPException(401, "Member sign-in required")
    config = _platform_membership(await _load_platform_config())
    member = sess["member"]
    is_local_test = bool(
        member.get("local_dev_test_account") and _is_local_dev_request(request)
    )
    if not config["experience_enabled"] and not is_local_test:
        raise HTTPException(403, "Member experience is disabled")
    plan = _effective_member_plan(member)
    if feature:
        from membership import plan_features
        feature_config = config
        if is_local_test:
            # Local test identities exercise tier features without opening member rollout.
            feature_config = {**config, "experience_enabled": True}
        if feature not in plan_features(feature_config, plan):
            raise HTTPException(403, "This feature is not included in your plan")
    return sess, config, plan


_MEMBER_ROUTE_FEATURES = (
    ("/positions", "positions"),
    ("/kite/user", "positions"),
    ("/trades", "trade_journal"),
    ("/journal", "trade_journal"),
    ("/desk-ai", "desk_ai"),
    ("/desk-guide", "desk_ai"),
    ("/market-intel", "market_intel"),
    ("/global-markets", "global_markets"),
    ("/adrs", "global_markets"),
    ("/alerts", "alerts"),
)


async def _require_member_route_access(request: Request):
    path = request.url.path.removeprefix("/api")
    feature = next(
        (feature for prefix, feature in _MEMBER_ROUTE_FEATURES if path.startswith(prefix)),
        None,
    )
    if feature:
        await _member_context(request, feature)


def _market_data_page_for_path(path: str):
    """Map data APIs to the dashboard page and member entitlement they serve."""
    route = path.removeprefix("/api").strip("/").split("/")
    if len(route) == 3 and route[0] == "oi" and route[2] == "change":
        return "oi-change", "oi_change"
    if len(route) == 2 and route[0] == "oi":
        return "open-interest", "open_interest"
    if len(route) == 2 and route[0] == "expiries":
        return "open-interest", "open_interest"
    if len(route) == 2 and route[0] == "history":
        return "open-interest", "open_interest"
    if len(route) == 2 and route[0] == "vrp":
        return "open-interest", "open_interest"
    if len(route) >= 2 and route[0] == "straddle":
        return "straddle", "straddle"
    return None


async def _enforce_market_data_access(request: Request, role: str):
    page = _market_data_page_for_path(request.url.path)
    if not page:
        return
    page_id, feature = page
    if role == "member":
        await _member_context(request, feature)
        return

    setting_key = "admin_visible_pages" if role == "admin" else "visible_pages"
    visible_pages = _live_settings().get(setting_key)
    if not isinstance(visible_pages, list):
        visible_pages = DEFAULT_SETTINGS.get(setting_key, [])
    if page_id not in visible_pages:
        raise HTTPException(403, "This dashboard page is not available")


def require_member_feature(feature: str):
    """Gate a shared-data API for paid members without changing legacy guest access."""
    async def _check(request: Request):
        if await _is_admin_request(request):
            return True
        sess = await _member_session_from_request(request)
        if sess:
            await _member_context(request, feature)
        return True
    return _check


async def require_member(request: Request):
    sess = await _member_session_from_request(request)
    if not sess:
        raise HTTPException(401, "Member sign-in required")
    return sess


async def _publisher_api_key_secret():
    """Publisher (desk) Kite Connect app — used for OI and to mint per-user sessions."""
    doc = await db.credentials.find_one({"_id": "kite"}) if db is not None else None
    if not doc:
        return None, None
    api_key = None
    api_secret = None
    try:
        if doc.get("api_key_enc"):
            api_key = _fernet().decrypt(doc["api_key_enc"].encode()).decode()
        else:
            api_key = doc.get("api_key")
    except Exception:
        api_key = None
    try:
        if doc.get("api_secret_enc"):
            api_secret = _fernet().decrypt(doc["api_secret_enc"].encode()).decode()
    except Exception:
        api_secret = None
    return (api_key or None), (api_secret or None)


async def _load_user_kite_doc(guest_sess: Optional[dict]):
    if not guest_sess:
        return None
    member_id = guest_sess.get("member_id")
    if member_id:
        by_member = await db.user_kite.find_one({"member_id": member_id})
        if by_member:
            return by_member
    if guest_sess.get("kite_access_token_enc"):
        return {
            "access_token_enc": guest_sess.get("kite_access_token_enc"),
            "kite_user_id": guest_sess.get("kite_user_id"),
            "valid_until": guest_sess.get("kite_valid_until"),
            "guest_token": guest_sess.get("_id"),
        }
    tok = guest_sess.get("_id")
    if tok:
        by_sess = await db.user_kite.find_one({"guest_token": tok})
        if by_sess:
            return by_sess
    uid = guest_sess.get("kite_user_id")
    if uid:
        found = await db.user_kite.find_one({"_id": str(uid)})
        if found:
            return found
    return None


async def _save_user_kite(guest_sess: dict, *, access_token: str, kite_user_id: Optional[str]):
    from user_kite import kite_token_valid_until
    until = kite_token_valid_until()
    enc = _fernet().encrypt(access_token.encode()).decode()
    now_iso = datetime.now(timezone.utc).isoformat()
    uid = str(kite_user_id or "").strip()
    fields = {
        "access_token_enc": enc,
        "kite_user_id": uid or None,
        "valid_until": until.isoformat(),
        "guest_token": None if guest_sess.get("member_id") else guest_sess["_id"],
        "member_id": guest_sess.get("member_id"),
        "guest_name": guest_sess.get("name") if not guest_sess.get("member_id") else None,
        "ip": guest_sess.get("ip"),
        "updated_at": now_iso,
    }
    if guest_sess.get("member_id"):
        await db.user_kite.update_one(
            {"member_id": guest_sess["member_id"]},
            {"$set": {**fields, "_id": f"member:{guest_sess['member_id']}"}},
            upsert=True,
        )
    elif uid:
        await db.user_kite.update_one({"_id": uid}, {"$set": fields}, upsert=True)
    else:
        await db.user_kite.update_one(
            {"guest_token": guest_sess["_id"]},
            {"$set": {**fields, "_id": guest_sess["_id"]}},
            upsert=True,
        )
    if not guest_sess.get("member_id"):
        await db.guest_sessions.update_one(
            {"_id": guest_sess["_id"]},
            {"$set": {
                "kite_access_token_enc": enc,
                "kite_user_id": uid or None,
                "kite_valid_until": until.isoformat(),
            }},
        )
    return fields


async def _bind_member_kite_identity(member_id: str, kite_user_id: Optional[str]) -> str:
    """Bind a Google member to the first successful Kite account without race-based replacement."""
    if db is None:
        raise HTTPException(503, "Database unavailable")
    account_id = str(kite_user_id or "").strip().upper()
    if not account_id:
        raise HTTPException(400, "The broker did not return an account ID.")
    member = await db.members.find_one(
        {"_id": member_id},
        {"linked_kite_user_id": 1},
    )
    if not member:
        raise HTTPException(404, "Member account not found.")
    existing_id = str(member.get("linked_kite_user_id") or "").strip().upper()
    if not existing_id:
        # Older member rows may already have a connected broker ID in user_kite.
        saved_kite = await db.user_kite.find_one(
            {"member_id": member_id},
            {"kite_user_id": 1},
        )
        existing_id = str((saved_kite or {}).get("kite_user_id") or "").strip().upper()
    identity_to_bind = existing_id or account_id
    result = await db.members.update_one(
        {
            "_id": member_id,
            "$or": [
                {"linked_kite_user_id": {"$exists": False}},
                {"linked_kite_user_id": None},
                {"linked_kite_user_id": identity_to_bind},
            ],
        },
        {"$set": {"linked_kite_user_id": identity_to_bind}},
    )
    if result.matched_count:
        if identity_to_bind != account_id:
            raise HTTPException(
                403,
                f"This Google account is already linked to broker account {identity_to_bind}.",
            )
        return identity_to_bind
    member = await db.members.find_one(
        {"_id": member_id},
        {"linked_kite_user_id": 1},
    )
    linked_id = str((member or {}).get("linked_kite_user_id") or "").strip().upper()
    if linked_id:
        if linked_id == account_id:
            return linked_id
        raise HTTPException(
            403,
            f"This Google account is already linked to broker account {linked_id}.",
        )
    raise HTTPException(503, "Could not lock the broker account to this member.")


async def _user_kite_client(guest_sess: Optional[dict]):
    from kiteconnect import KiteConnect
    from user_kite import public_status
    doc = await _load_user_kite_doc(guest_sess)
    member_id = (guest_sess or {}).get("member_id")
    if member_id:
        member_api_key = _decrypt_safe(doc.get("api_key_enc")) if doc else None
        member_api_secret = _decrypt_safe(doc.get("api_secret_enc")) if doc else None
        st = {
            **public_status(doc),
            "credentials_configured": bool(member_api_key and member_api_secret),
            "api_key_hint": f"••••{member_api_key[-4:]}" if member_api_key else None,
            "credentials_updated_at": doc.get("credentials_updated_at") if doc else None,
            "member_name": (guest_sess or {}).get("name"),
            "member_email": (guest_sess or {}).get("email"),
        }
    else:
        st = public_status(doc)
    if not st["connected"]:
        return None, st
    if member_id:
        key = member_api_key
        if not key or not member_api_secret:
            return None, {
                **st,
                "connected": False,
                "error": "Save your broker API key and secret once before connecting today's session.",
            }
    else:
        key, _secret = await _publisher_api_key_secret()
    if not key:
        error = (
            "Your broker app credentials are not configured."
            if member_id else "Publisher broker app is not configured."
        )
        return None, {**st, "connected": False, "error": error}
    try:
        token = _fernet().decrypt(doc["access_token_enc"].encode()).decode()
    except Exception:
        return None, {**st, "connected": False, "expired": True, "error": "Stored broker token could not be read."}
    kc = KiteConnect(api_key=key)
    kc.set_access_token(token)
    return kc, st


async def _auth_user_kite_payload(is_admin: bool, guest_sess: Optional[dict]) -> dict:
    from user_kite import public_status
    if is_admin:
        uid = getattr(tracker, "kite_user_id", None) if tracker else None
        connected = bool(tracker and tracker.kite_service and getattr(tracker, "mode", None) == "kite")
        return {"role": "admin", "connected": connected, "expired": False, "kite_user_id": uid, "publisher": True}
    if not guest_sess:
        return {"role": "guest", "connected": False, "expired": False, "kite_user_id": None, "publisher": False}
    doc = await _load_user_kite_doc(guest_sess)
    if guest_sess.get("member_id"):
        api_key = _decrypt_safe(doc.get("api_key_enc")) if doc else None
        api_secret = _decrypt_safe(doc.get("api_secret_enc")) if doc else None
        return {
            "role": "member",
            "publisher": False,
            **public_status(doc),
            "credentials_configured": bool(api_key and api_secret),
            "api_key_hint": f"••••{api_key[-4:]}" if api_key else None,
            "credentials_updated_at": doc.get("credentials_updated_at") if doc else None,
            "member_name": guest_sess.get("name"),
            "member_email": guest_sess.get("email"),
        }
    return {"role": "guest", "publisher": False, **public_status(doc)}


def _sanitize_public_error(err: Optional[str]) -> Optional[str]:
    """Never echo raw Kite/API exceptions (may include key/token fragments) to guests."""
    if not err:
        return None
    low = str(err).lower()
    if any(k in low for k in ("token", "api_key", "api key", "secret", "unauthorized", "forbidden", "incorrect", "signature")):
        return "Broker authentication issue — admin must reconnect"
    return "Data feed temporarily unavailable"


def _public_status_payload(status: dict) -> dict:
    """Keep member-facing feed health without exposing the provider integration."""
    public = dict(status)
    if public.get("mode") == "kite":
        public["mode"] = "live"
    public["publisher_feed_configured"] = bool(public.pop("has_kite_credentials", False))
    public["publisher_feed_live"] = bool(public.pop("kite_ok", False))
    public["publisher_feed_attention"] = bool(public.pop("kite_token_issue", False))
    public.pop("kite_user_id", None)
    public.pop("metrics", None)
    maintenance = public.pop("kite_maintenance", None)
    if isinstance(maintenance, dict) and maintenance.get("active"):
        public["broker_maintenance"] = {
            "active": True,
            "message": "Market data service maintenance may affect live updates.",
        }
    return public


def _public_ticker_payload(payload: dict) -> dict:
    """Expose quote freshness, not the underlying market-data provider."""
    public = dict(payload)
    if public.get("mode") == "kite":
        public["mode"] = "live"
    public["tickers"] = []
    for row in payload.get("tickers") or []:
        if not isinstance(row, dict):
            continue
        quote = dict(row)
        source = quote.pop("source", None)
        quote["is_live"] = source == "kite"
        public["tickers"].append(quote)
    return public


def _public_oi_snapshot(snapshot: Optional[dict]) -> Optional[dict]:
    if not isinstance(snapshot, dict):
        return snapshot
    public = dict(snapshot)
    public.pop("mode", None)
    public.pop("source", None)
    return public


def _public_extra_tickers_payload(payload: dict) -> dict:
    import market_intel

    public = market_intel.remove_public_source_metadata(payload)
    for key in ("vix", "gift_nifty"):
        row = public.get(key)
        if isinstance(row, dict) and row.get("note"):
            row["note"] = "Proxy reference used; it may differ from the live index."
    return public


async def _store_oi_snapshot(snapshot: Dict[str, Any], *, index_name: Optional[str] = None) -> None:
    """Persist one OI snapshot idempotently per (index, timestamp, expiry)."""
    if tracker:
        try:
            await tracker.persist_snapshot(snapshot, index_name=index_name)
            return
        except Exception:
            # fall back to direct DB persisted snapshot if tracker helper fails
            pass

    doc = dict(snapshot or {})
    if index_name:
        doc.setdefault("index", index_name)
    doc["timestamp"] = doc.get("timestamp") or datetime.now(timezone.utc).isoformat()
    created_at = datetime.now(timezone.utc).isoformat()
    set_doc = {k: v for k, v in doc.items() if k != "created_at"}
    await db.oi_snapshots.update_one(
        {
            "index": doc.get("index"),
            "timestamp": doc.get("timestamp"),
            "expiry": doc.get("expiry"),
        },
        {"$set": set_doc, "$setOnInsert": {"created_at": created_at}},
        upsert=True,
    )


async def _persist_straddle_sample(index_name: str, snap: dict):
    """Delegate to tracker._store_straddle_sample if tracker is available.

    This keeps persistence logic centralized in OITracker so behavior is
    consistent between background sampler, WS streams and poll loop.
    """
    try:
        if tracker:
            await tracker._store_straddle_sample(index_name, snap)
    except Exception:
        # Best-effort; don't raise from background sampler
        pass


async def _straddle_sampler():
    """Dense ATM straddle sampler for the intraday chart (FinanceDeft-style).

    Uses a lightweight 3-instrument quote (spot + ATM CE + PE). Cadence is
    Admin `straddle_poll_interval_seconds` from Mongo. Falls back to last OI
    snapshot only while that source snapshot is fresh.
    """
    poll_interval_seconds = 15
    while True:
        try:
            if tracker:
                try:
                    await tracker.sync_poll_intervals_from_db()
                except Exception:
                    pass
            poll_interval_seconds = clamp_straddle_poll_seconds(
                tracker.settings if tracker else None,
            )

            enabled = tracker.settings.get("straddle_enabled_indices") if tracker else None
            if not enabled:
                enabled = STRADDLE_INDICES

            if tracker.oi_session_open() and tracker:
                svc = tracker._get_service() if hasattr(tracker, "_get_service") else None
                for idx in enabled:
                    if idx not in INDEX_CONFIG:
                        continue
                    try:
                        snap = None
                        exp = tracker.selected_expiry.get(idx)
                        if svc and hasattr(svc, "get_atm_straddle_quote"):
                            snap = await asyncio.to_thread(svc.get_atm_straddle_quote, idx, exp)
                        if not _is_recent_straddle_sample(
                            snap,
                            _straddle_fallback_max_age_seconds(),
                        ):
                            snap = None
                        if not snap:
                            cached = tracker.last_snapshot.get(idx)
                            if _is_recent_straddle_sample(
                                cached,
                                _straddle_fallback_max_age_seconds(),
                            ):
                                snap = cached
                        if snap:
                            await _persist_straddle_sample(idx, snap)
                    except Exception as e:
                        logger.warning(f"straddle sampler failed for {idx}: {e}")
                await asyncio.sleep(poll_interval_seconds)
            else:
                await asyncio.sleep(min(poll_interval_seconds, 60))
        except asyncio.CancelledError:
            break
        except Exception as e:
            logger.exception(f"straddle sampler loop error: {e}")
            try:
                await asyncio.sleep(poll_interval_seconds)
            except Exception:
                await asyncio.sleep(poll_interval_seconds)


async def _market_day_poll_watchdog():
    """Keep OI Change / Open Interest / straddle DB writes alive on market days.

    Independent of any browser session — restarts a dead poller and forces a
    warm poll when the last successful tick exceeds the dynamic STALE window.
    """
    while True:
        try:
            if tracker:
                await tracker.ensure_market_day_polling()
            await asyncio.sleep(30)
        except asyncio.CancelledError:
            break
        except Exception as e:
            logger.warning("market-day poll watchdog error: %s", e)
            await asyncio.sleep(30)


async def _guest_from_request(request: Request):
    member = await _member_session_from_request(request)
    if member:
        return member
    tok = _extract_bearer(request, "x-guest-token")
    if not tok:
        return None
    sess = await _find_one_capped(db.guest_sessions, {"_id": tok})
    if not sess:
        return None
    # Guests are only valid while public access is open. Signed-in members
    # (e.g. Google login) keep their session regardless of the public-door toggle.
    if not sess.get("is_member"):
        open_, _ = await _get_public_access_state()
        if not open_:
            return None
    if sess.get("revoked_at"):
        return None
    ip = _client_ip(request)
    if await _is_ip_blocked(ip) or (sess.get("ip") and await _is_ip_blocked(sess.get("ip"))):
        try:
            await db.guest_sessions.update_one(
                {"_id": tok},
                {"$set": {
                    "revoked_at": datetime.now(timezone.utc).isoformat(),
                    "revoked_reason": "ip_blocked",
                }},
            )
        except Exception:
            pass
        return None
    try:
        started = datetime.fromisoformat(sess.get("started_at"))
    except Exception:
        return None
    now_utc = datetime.now(timezone.utc)
    # Prefer stored daily expiry (next 06:00 IST); legacy sessions fall back.
    expires_at = None
    raw_exp = sess.get("expires_at")
    if raw_exp:
        try:
            expires_at = datetime.fromisoformat(raw_exp)
            if expires_at.tzinfo is None:
                expires_at = expires_at.replace(tzinfo=timezone.utc)
        except Exception:
            expires_at = None
    if expires_at is None:
        try:
            expires_at = _guest_expiry_from_start(started)
        except Exception:
            expires_at = None
    if expires_at is not None and now_utc >= expires_at:
        return None
    # Absolute safety cap for very old sessions.
    if (now_utc - started).total_seconds() > GUEST_SESSION_TTL_SECONDS:
        return None
    # Throttle last_seen writes — auth/state is polled often; avoid write amplification.
    try:
        last_seen = sess.get("last_seen_at")
        should_touch = True
        if last_seen:
            try:
                ls = datetime.fromisoformat(last_seen)
                should_touch = (datetime.now(timezone.utc) - ls).total_seconds() >= 60
            except Exception:
                should_touch = True
        if should_touch:
            await db.guest_sessions.update_one(
                {"_id": tok},
                {"$set": {"last_seen_at": datetime.now(timezone.utc).isoformat()}},
            )
    except Exception:
        pass
    return sess


def _next_market_close_ist() -> datetime:
    from market_hours import IST, is_trading_day, session_display_bounds
    now = datetime.now(IST)
    _open, close_t = session_display_bounds(now)
    close = now.replace(hour=close_t.hour, minute=close_t.minute, second=0, microsecond=0)
    if now >= close:
        close = close + timedelta(days=1)
    for _ in range(15):
        if is_trading_day(close):
            _o, ct = session_display_bounds(close)
            close = close.replace(hour=ct.hour, minute=ct.minute, second=0, microsecond=0)
            break
        close = close + timedelta(days=1)
        close = close.replace(hour=close_t.hour, minute=close_t.minute, second=0, microsecond=0)
    return close.astimezone(timezone.utc)


async def _get_public_access_state():
    if db is None:
        return False, None
    doc = await _find_one_capped(db.settings, {"_id": "public_access"}) or {}
    open_ = bool(doc.get("open", False))
    exp = doc.get("expires_at")
    expires_at_iso = None
    if exp:
        try:
            exp_dt = datetime.fromisoformat(exp)
            if datetime.now(timezone.utc) >= exp_dt:
                await db.settings.update_one(
                    {"_id": "public_access"}, {"$set": {"open": False, "expires_at": None}}, upsert=True
                )
                # Auto-expiry must revoke lingering guest tokens — otherwise guests
                # keep picking up live OI after the intended cut-off.
                if open_:
                    await _revoke_guest_sessions("public_access_expired")
                open_ = False
            else:
                expires_at_iso = exp_dt.isoformat()
        except Exception:
            open_ = False
    return open_, expires_at_iso


async def _get_maintenance_state() -> bool:
    """Return the persisted public maintenance switch without leaking DB errors."""
    if db is None:
        return False
    try:
        doc = await _find_one_capped(db.settings, {"_id": "maintenance_mode"}) or {}
        return bool(doc.get("enabled", False))
    except Exception:
        return False


async def _get_guest_require_approval() -> bool:
    if db is None:
        return False
    doc = await _find_one_capped(db.settings, {"_id": "public_access"}) or {}
    return require_approval_flag(doc)


async def _get_guest_login_enabled() -> bool:
    if db is None:
        return False
    doc = await _load_platform_config()
    return (doc or {}).get("guest_login_enabled") is True


async def _revoke_guest_sessions(reason: Optional[str] = None):
    update = {"revoked_at": datetime.now(timezone.utc).isoformat()}
    if reason:
        update["revoked_reason"] = reason
    try:
        await db.guest_sessions.update_many({"revoked_at": {"$exists": False}}, {"$set": update})
    except Exception:
        pass


async def _is_ip_blocked(ip: Optional[str]) -> bool:
    if not ip:
        return False
    try:
        doc = await db.blocked_ips.find_one({"_id": ip})
        return bool(doc)
    except Exception:
        return False


async def _revoke_guests_for_ip(ip: str, reason: str = "ip_blocked"):
    if not ip:
        return 0
    now_iso = datetime.now(timezone.utc).isoformat()
    try:
        r = await db.guest_sessions.update_many(
            {"ip": ip, "revoked_at": {"$exists": False}},
            {"$set": {"revoked_at": now_iso, "revoked_reason": reason}},
        )
        return int(getattr(r, "modified_count", 0) or 0)
    except Exception:
        return 0


async def _pending_access_count() -> int:
    try:
        return int(await db.access_requests.count_documents({"status": "pending"}))
    except Exception:
        return 0


async def _create_guest_session(name: str, ip: Optional[str], ua: str, *, request_id: Optional[str] = None) -> dict:
    token = secrets.token_urlsafe(32)
    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()
    expires_at = _next_6am_ist_utc(now)
    expires_iso = expires_at.isoformat()
    doc = {
        "_id": token,
        "name": name,
        "ip": ip,
        "user_agent": ua,
        "started_at": now_iso,
        "last_seen_at": now_iso,
        "expires_at": expires_iso,
    }
    if request_id:
        doc["access_request_id"] = request_id
    await db.guest_sessions.insert_one(doc)
    return {
        "token": token,
        "name": name,
        "expires_in_seconds": _guest_seconds_remaining(expires_at, now),
        "expires_at": expires_iso,
        "started_at": now_iso,
    }


async def _admit_guest_immediate(
    name: str,
    ip: Optional[str],
    ua: str,
    *,
    reason: str = "open_door",
) -> dict:
    """Register the guest name and mint a session without an admin click."""
    now_iso = datetime.now(timezone.utc).isoformat()
    req_id = None
    if ip:
        existing = await db.access_requests.find_one({"ip": ip, "status": "pending"})
        if existing:
            req_id = existing["_id"]
    if not req_id:
        req_id = secrets.token_urlsafe(16)
        await db.access_requests.insert_one({
            "_id": req_id,
            "name": name,
            "ip": ip,
            "user_agent": ua,
            "status": "pending",
            "created_at": now_iso,
            "updated_at": now_iso,
        })
    guest = await _create_guest_session(name, ip, ua, request_id=req_id)
    await db.access_requests.update_one(
        {"_id": req_id},
        {"$set": {
            "name": name,
            "ip": ip,
            "user_agent": ua,
            "status": "approved",
            "updated_at": now_iso,
            "decided_at": now_iso,
            "decided_reason": reason,
            "guest_token": guest["token"],
        }},
    )
    if ip:
        try:
            await db.access_requests.update_many(
                {"ip": ip, "status": "pending", "_id": {"$ne": req_id}},
                {"$set": {
                    "status": "consumed",
                    "decided_at": now_iso,
                    "decided_reason": reason,
                    "consumed_at": now_iso,
                }},
            )
        except Exception:
            pass
    logger.info(f"ACCESS {reason}: name='{name}' ip={ip} id={req_id}")
    return {
        "ok": True,
        "status": "approved",
        "token": guest["token"],
        "name": name,
        "expires_in_seconds": guest["expires_in_seconds"],
        "expires_at": guest.get("expires_at"),
        "source": reason,
        "request_id": req_id,
        "message": "Welcome",
    }


# ------------------- Models -------------------
class CredentialsIn(BaseModel):
    api_key: str
    access_token: str


class AccessTokenOnlyIn(BaseModel):
    access_token: str


class ModeIn(BaseModel):
    mode: str  # "kite" | "offline"


DASHBOARD_PAGE_KEYS = {
    "oi-change", "open-interest", "strike-table", "sell-candidates",
    "buildup", "positions", "alerts", "activity", "holidays",
    "straddle", "index-events", "cas", "market-intel", "adrs",
}


def _sanitize_settings_catalog_values(settings: dict, valid_indices=None, fallback_empty=True) -> dict:
    """Remove retired page/index IDs while preserving required-selection validation."""
    for key in ("visible_pages", "admin_visible_pages"):
        pages = settings.get(key)
        if not isinstance(pages, list):
            continue
        valid = list(dict.fromkeys(
            page for page in pages if isinstance(page, str) and page in DASHBOARD_PAGE_KEYS
        ))
        if not valid and fallback_empty:
            defaults = DEFAULT_SETTINGS.get(key) or ["oi-change"]
            valid = [page for page in defaults if page in DASHBOARD_PAGE_KEYS]
        settings[key] = valid

    indices = set(valid_indices if valid_indices is not None else INDEX_CONFIG)
    for key in ("enabled_indices", "alert_enabled_indices", "straddle_enabled_indices"):
        values = settings.get(key)
        if not isinstance(values, list):
            continue
        clean = list(dict.fromkeys(
            index for index in values if isinstance(index, str) and index in indices
        ))
        if not clean and fallback_empty and key in ("enabled_indices", "alert_enabled_indices"):
            defaults = (
                settings.get("enabled_indices") or DEFAULT_SETTINGS.get(key) or []
                if key == "alert_enabled_indices"
                else DEFAULT_SETTINGS.get(key) or []
            )
            clean = [index for index in defaults if index in indices]
            if not clean and indices:
                clean = [sorted(indices)[0]]
        settings[key] = clean

    weekday_defaults = settings.get("weekday_dashboard_defaults")
    if isinstance(weekday_defaults, dict):
        settings["weekday_dashboard_defaults"] = {
            day: index for day, index in weekday_defaults.items()
            if isinstance(index, str) and index in indices
        }

    lot_sizes = settings.get("lot_sizes")
    if isinstance(lot_sizes, dict):
        clean_lots = {}
        for index, raw_size in lot_sizes.items():
            try:
                size = int(raw_size)
            except (TypeError, ValueError):
                continue
            if index in indices and size > 0:
                clean_lots[index] = size
        settings["lot_sizes"] = clean_lots
    return settings


class SettingsIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    sitewalkthrough_enabled: Optional[bool] = None
    threshold_pct: Optional[float] = None
    cooldown_seconds: Optional[int] = None
    compare_minutes: Optional[int] = None
    enabled_indices: Optional[List[str]] = None
    oi_poll_interval_seconds: Optional[int] = None  # OI data pull interval (15/30/60)
    straddle_poll_interval_seconds: Optional[int] = None  # Straddle data pull interval (60 = 1 min)
    positions_poll_interval_seconds: Optional[int] = None  # Positions desk auto-refresh (1–3600s)
    trade_cycle_saving_enabled: Optional[bool] = None  # Admin-only broker-book cycle history
    market_intel_ingest_seconds: Optional[int] = None
    market_intel_retention_days: Optional[int] = None
    market_intel_min_history_days: Optional[int] = None
    market_intel_popup_enabled: Optional[bool] = None
    market_intel_popup_dock_until_next: Optional[bool] = None
    cas_iep_enabled: Optional[bool] = None
    cas_iep_start_ist: Optional[str] = None
    cas_iep_end_ist: Optional[str] = None
    cas_iep_interval_seconds: Optional[int] = None
    cas_iep_force: Optional[bool] = None
    straddle_enabled_indices: Optional[List[str]] = None  # Which indices to track for straddle
    visible_pages: Optional[List[str]] = None
    admin_visible_pages: Optional[List[str]] = None
    market_open_ist: Optional[str] = None   # e.g. "09:15"
    market_close_ist: Optional[str] = None  # e.g. "15:40" (Index F&O / CAS)
    second_session_ist: Optional[str] = None  # e.g. "12:00" BigClock 2nd-session notify
    expire_admin_on_market_close: Optional[bool] = None
    admin_session_ttl_minutes: Optional[int] = None
    alert_enabled_indices: Optional[List[str]] = None  # weekday-defaulted alert focus
    weekday_dashboard_defaults: Optional[Dict[str, str]] = None  # Mon..Fri default desk index
    show_strike_range: Optional[bool] = None  # sidebar Strike Range steppers
    show_market_memory: Optional[bool] = None  # OI Change historical level memory card
    show_writer_defense: Optional[bool] = None  # Writer Defense map on Open Interest tab
    show_suggestion: Optional[bool] = None  # Suggestion window under right panel
    show_chart_signals: Optional[bool] = None  # Gamma wall / institution CE·PE chips under OI Change chart
    position_mark_glow_after_close: Optional[bool] = None  # Keep near-ATM position ring after configured close
    position_mark_glow_pct: Optional[float] = None  # Glow S/L only within this % of spot
    alert_toast_opacity: Optional[int] = None  # Desktop in-app alert translucency
    overnight_popup_opacity: Optional[int] = None
    market_intel_popup_opacity: Optional[int] = None
    indicative_popup_opacity: Optional[int] = None
    desk_ai_show: Optional[bool] = None  # Header: Desk AI on/off for the whole desk
    desk_ai_ask: Optional[bool] = None  # Kept for compat; on whenever Desk AI is on
    desk_ai_positions: Optional[bool] = None  # Positions page intelligence strip
    desk_ai_radar: Optional[bool] = None  # Book radar intelligence (toggled on Radar)
    desk_ai_carry: Optional[bool] = None  # Overnight carry-brief coach (desktop)
    desk_ai_admin: Optional[bool] = None  # Compat alias of desk_ai_show
    desk_ai_public: Optional[bool] = None  # Compat alias of desk_ai_show
    mcx_desk_on: Optional[bool] = None  # Master MCX majors switch; Enable still per-name
    lot_sizes: Optional[Dict[str, int]] = None  # Kite F&O lot size per index (chart signals)

    @field_validator(
        "cooldown_seconds",
        "compare_minutes",
        "oi_poll_interval_seconds",
        "straddle_poll_interval_seconds",
        "positions_poll_interval_seconds",
        "market_intel_ingest_seconds",
        "market_intel_retention_days",
        "market_intel_min_history_days",
        "admin_session_ttl_minutes",
        "cas_iep_interval_seconds",
        mode="before",
    )
    @classmethod
    def _blank_int_to_none(cls, v):
        if v == "":
            return None
        return v


class LoginIn(BaseModel):
    username: str
    password: str
    remember_me: Optional[bool] = False


class ExpiryIn(BaseModel):
    expiry: Optional[str] = None


class GenerateTokenIn(BaseModel):
    api_key: str
    api_secret: str
    request_token: str
    remember: Optional[bool] = True


class RefreshTokenIn(BaseModel):
    request_token: str


class VaultIn(BaseModel):
    """Persist or clear long-lived Kite API key / secret (Fernet-encrypted)."""
    api_key: Optional[str] = None
    api_secret: Optional[str] = None
    clear_api_key: Optional[bool] = False
    clear_api_secret: Optional[bool] = False


@api_router.get("/")
async def root():
    return {
        "message": "NSE OI Tracker API",
        "name": APP_NAME,
        "version": APP_VERSION,
        "version_label": APP_VERSION_LABEL,
        "indices": list(INDEX_CONFIG.keys()),
    }


@api_router.get("/status")
async def get_status(request: Request):
    if not tracker:
        return {
            "running": False,
            "mode": "offline",
            "booting": True,
            "app_version": APP_VERSION,
            "app_version_label": APP_VERSION_LABEL,
            "app_name": APP_NAME,
        }
    # Best-effort bulletin probe (cached, non-blocking) so maintenance surfaces in-app.
    async def _probe_bulletin():
        try:
            from kite_maintenance import fetch_bulletin_notice, merge_maintenance

            bulletin = await asyncio.to_thread(fetch_bulletin_notice)
            tracker.kite_maintenance = merge_maintenance(
                tracker.kite_maintenance,
                bulletin=bulletin,
            )
        except Exception:
            pass

    try:
        asyncio.create_task(_probe_bulletin())
    except Exception:
        pass
    status = await tracker.get_status()
    # Guests / anonymous never receive raw Kite exception text (may contain key fragments).
    if not await _is_admin_request(request):
        status = _public_status_payload(status)
        status["last_error"] = _sanitize_public_error(status.get("last_error"))
    status = dict(status)
    status["app_version"] = APP_VERSION
    status["app_version_label"] = APP_VERSION_LABEL
    status["app_name"] = APP_NAME
    return status


@api_router.get("/version")
async def get_version():
    """Public product version so any host / new AI session can pin the tree."""
    return {
        "name": APP_NAME,
        "version": APP_VERSION,
        "version_label": APP_VERSION_LABEL,
    }


@api_router.post("/credentials")
async def set_credentials(payload: CredentialsIn, _admin: bool = Depends(require_admin)):
    try:
        await _require_tracker().set_credentials(payload.api_key, payload.access_token)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    # Pull true GIFT NIFTY (NSEIX:GIFT NIFTY) + VIX via Kite immediately.
    try:
        await extra_tickers.force_refresh()
    except Exception:
        pass
    return {"ok": True, "mode": tracker.mode}


@api_router.post("/credentials/access-token")
async def set_access_token_only(payload: AccessTokenOnlyIn, _admin: bool = Depends(require_admin)):
    """Update daily access_token using the Fernet-vaulted api_key (no re-entry)."""
    doc = await db.credentials.find_one({"_id": "kite"})
    api_key = None
    try:
        if doc and doc.get("api_key_enc"):
            api_key = _fernet().decrypt(doc["api_key_enc"].encode()).decode()
        elif doc and doc.get("api_key"):
            api_key = doc.get("api_key")
    except Exception:
        api_key = None
    if not api_key:
        raise HTTPException(400, "No stored API key — enter api_key once, then paste access_token.")
    token = str(payload.access_token or "").strip()
    if not token:
        raise HTTPException(400, "access_token required")
    try:
        await _require_tracker().set_credentials(api_key, token)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    try:
        await extra_tickers.force_refresh()
    except Exception:
        pass
    return {"ok": True, "mode": tracker.mode}


@api_router.post("/kite/generate-session")
async def generate_session(payload: GenerateTokenIn, _admin: bool = Depends(require_admin)):
    """Exchange api_key + api_secret + request_token for a fresh access_token
    using KiteConnect.generate_session(), save it, and switch to LIVE mode."""
    active_tracker = _require_tracker()
    try:
        from kiteconnect import KiteConnect
        kc = KiteConnect(api_key=payload.api_key)
        data = kc.generate_session(payload.request_token, api_secret=payload.api_secret)
        access_token = data.get("access_token")
        if not access_token:
            raise RuntimeError("No access_token returned by Kite")
    except Exception as e:
        raise HTTPException(400, f"{type(e).__name__}: {e}")
    try:
        await active_tracker.set_credentials(payload.api_key, access_token)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(400, str(e))
    # Always vault key + secret (Fernet) so daily login needs only request_token.
    if payload.remember is not False:
        enc_secret = _fernet().encrypt(payload.api_secret.encode()).decode()
        enc_key = _fernet().encrypt(payload.api_key.encode()).decode()
        uid = data.get("user_id")
        await db.credentials.update_one(
            {"_id": "kite"},
            {
                "$set": {
                    "api_secret_enc": enc_secret,
                    "api_key_enc": enc_key,
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                    **({"kite_user_id": str(uid)} if uid else {}),
                },
                "$unset": {"api_key": "", "access_token": ""},
            },
            upsert=True,
        )
    if data.get("user_id"):
        tracker.kite_user_id = str(data.get("user_id"))
    return {"ok": True, "mode": tracker.mode, "user_id": data.get("user_id"), "remembered": payload.remember is not False}


@api_router.get("/kite/vault")
async def vault_status(_admin: bool = Depends(require_admin)):
    """Vault status for the credentials modal — never returns plaintext secret."""
    doc = await db.credentials.find_one(
        {"_id": "kite"},
        {"_id": 0, "api_key_enc": 1, "api_secret_enc": 1, "api_key": 1, "updated_at": 1},
    )
    api_key = None
    if doc:
        try:
            if doc.get("api_key_enc"):
                api_key = _fernet().decrypt(doc["api_key_enc"].encode()).decode()
            else:
                api_key = doc.get("api_key")
        except Exception:
            api_key = None
    has_secret = bool(doc and doc.get("api_secret_enc"))
    # Login URL is built server-side (admin-only). Secret never leaves the vault.
    login_url = (
        f"https://kite.zerodha.com/connect/login?v=3&api_key={api_key}"
        if api_key
        else None
    )
    return {
        "has_api_key": bool(api_key),
        "has_api_secret": has_secret,
        "api_key_hint": (api_key[:4] + "***") if api_key else None,
        "api_secret_hint": "••••••••" if has_secret else None,
        "login_url": login_url,
        "updated_at": doc.get("updated_at") if doc else None,
        "storage": "fernet",
    }


@api_router.post("/kite/vault")
async def vault_save(payload: VaultIn, _admin: bool = Depends(require_admin)):
    """Save or clear long-lived api_key / api_secret (Fernet ciphertext in Mongo).

    Rotating api_key invalidates the stored access_token — a token is bound to
    the app key that issued it. Keeping the old token with a new key produces
    TokenException: Incorrect api_key or access_token on every Kite call.
    """
    unset: dict = {}
    sets: dict = {"updated_at": datetime.now(timezone.utc).isoformat()}
    needs_reauth = False

    doc = await db.credentials.find_one({"_id": "kite"})
    old_key = None
    if doc:
        try:
            if doc.get("api_key_enc"):
                old_key = _fernet().decrypt(doc["api_key_enc"].encode()).decode()
            else:
                old_key = doc.get("api_key")
        except Exception:
            old_key = None

    if payload.clear_api_key:
        unset["api_key_enc"] = ""
        unset["api_key"] = ""
        unset["access_token_enc"] = ""
        unset["access_token"] = ""
        needs_reauth = True
    elif payload.api_key is not None:
        key = str(payload.api_key).strip()
        if not key:
            raise HTTPException(400, "api_key cannot be empty")
        sets["api_key_enc"] = _fernet().encrypt(key.encode()).decode()
        unset["api_key"] = ""
        if old_key and key != old_key:
            # New app key cannot use the previous access_token.
            unset["access_token_enc"] = ""
            unset["access_token"] = ""
            needs_reauth = True

    if payload.clear_api_secret:
        unset["api_secret_enc"] = ""
    elif payload.api_secret is not None:
        secret = str(payload.api_secret).strip()
        if not secret:
            raise HTTPException(400, "api_secret cannot be empty")
        sets["api_secret_enc"] = _fernet().encrypt(secret.encode()).decode()

    if len(sets) == 1 and not unset:
        raise HTTPException(400, "Nothing to update")

    update: dict = {"$set": sets}
    if unset:
        update["$unset"] = unset
    await db.credentials.update_one({"_id": "kite"}, update, upsert=True)

    if needs_reauth and tracker is not None:
        tracker.kite_service = None
        tracker.mode = "offline"
        tracker.offline_sticky = True
        tracker.last_error = (
            "API key updated — complete broker login (request_token) or paste a "
            "fresh access_token to go live."
        )

    status = await vault_status(_admin=True)
    status["needs_reauth"] = needs_reauth
    return status


@api_router.post("/kite/refresh")
async def kite_refresh(payload: RefreshTokenIn, _admin: bool = Depends(require_admin)):
    """One-click daily refresh: uses stored api_key + encrypted api_secret + given request_token."""
    active_tracker = _require_tracker()
    doc = await db.credentials.find_one({"_id": "kite"})
    api_key = None
    try:
        if doc and doc.get("api_key_enc"):
            api_key = _fernet().decrypt(doc["api_key_enc"].encode()).decode()
        elif doc and doc.get("api_key"):
            api_key = doc.get("api_key")
    except Exception:
        api_key = None
    if not doc or not api_key or not doc.get("api_secret_enc"):
        raise HTTPException(400, "No stored api_key/api_secret — save them once in Credentials first.")
    try:
        api_secret = _fernet().decrypt(doc["api_secret_enc"].encode()).decode()
    except Exception:
        raise HTTPException(400, "Stored api_secret could not be decrypted — re-enter API secret.")
    try:
        from kiteconnect import KiteConnect
        kc = KiteConnect(api_key=api_key)
        data = kc.generate_session(payload.request_token, api_secret=api_secret)
        access_token = data.get("access_token")
        if not access_token:
            raise RuntimeError("No access_token returned by Kite")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(400, f"{type(e).__name__}: {e}")
    try:
        await active_tracker.set_credentials(api_key, access_token)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(400, str(e))
    if data.get("user_id"):
        active_tracker.kite_user_id = str(data.get("user_id"))
        try:
            await db.credentials.update_one(
                {"_id": "kite"},
                {"$set": {"kite_user_id": active_tracker.kite_user_id}},
                upsert=True,
            )
        except Exception:
            pass
    return {"ok": True, "mode": tracker.mode, "user_id": data.get("user_id")}


@api_router.delete("/kite/vault")
async def clear_vault(_admin: bool = Depends(require_admin)):
    """Sign out of the broker — wipe vaulted Kite credentials and go offline."""
    await db.credentials.update_one(
        {"_id": "kite"},
        {
            "$unset": {
                "api_key_enc": "",
                "access_token_enc": "",
                "api_secret_enc": "",
                "api_key": "",
                "access_token": "",
                "kite_user_id": "",
            }
        },
    )
    if tracker is not None:
        tracker.kite_service = None
        tracker.mode = "offline"
        tracker.kite_user_id = None
        tracker.kite_maintenance = None
        tracker.offline_sticky = True
        tracker.last_error = "Broker signed out — connect again to go live."
    return {"ok": True, "mode": "offline"}


@api_router.get("/credentials/status")
async def credentials_status(_admin: bool = Depends(require_admin)):
    doc = await db.credentials.find_one(
        {"_id": "kite"},
        {"_id": 0, "api_key_enc": 1, "api_key": 1, "api_secret_enc": 1, "updated_at": 1},
    )
    api_key = None
    if doc:
        try:
            if doc.get("api_key_enc"):
                api_key = _fernet().decrypt(doc["api_key_enc"].encode()).decode()
            else:
                api_key = doc.get("api_key")
        except Exception:
            api_key = None
    return {
        "configured": bool(doc and (doc.get("api_key_enc") or doc.get("api_key"))),
        "has_api_secret": bool(doc and doc.get("api_secret_enc")),
        "api_key_hint": (api_key[:4] + "***") if api_key else None,
        "updated_at": doc.get("updated_at") if doc else None,
        "storage": "fernet",
    }


@api_router.post("/mode")
async def set_mode(payload: ModeIn, _admin: bool = Depends(require_admin)):
    try:
        await tracker.set_mode(payload.mode)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"ok": True, "mode": tracker.mode}


@api_router.post("/tracker/start")
async def tracker_start(_admin: bool = Depends(require_admin)):
    await tracker.start()
    return await tracker.get_status()


@api_router.post("/tracker/stop")
async def tracker_stop(_admin: bool = Depends(require_admin)):
    await tracker.stop()
    return await tracker.get_status()


@api_router.get("/oi/{index_name}")
async def get_current_oi(
    index_name: str,
    expiry: Optional[str] = None,
    _who: str = Depends(require_desk_user),
):
    idx = index_name.upper()
    if idx not in INDEX_CONFIG:
        raise HTTPException(404, "Unknown index")
    # Do NOT mutate tracker.selected_expiry from a GET — that would switch the
    # shared background poller for every client. Expiry is a read filter only.
    # Never hit Kite on this path (instrument dump / chain quote blocks the origin).
    snap = tracker.last_snapshot.get(idx) if tracker else None
    if snap and expiry and snap.get("expiry") != expiry:
        snap = None
    if not snap:
        try:
            doc = await asyncio.wait_for(
                db.oi_snapshots.find_one(
                    {"index": idx, **({"expiry": expiry} if expiry else {})},
                    sort=[("timestamp", -1)],
                    projection={"_id": 0},
                    maxTimeMS=1500,
                ),
                timeout=2.0,
            )
        except TypeError:
            doc = await asyncio.wait_for(
                db.oi_snapshots.find_one(
                    {"index": idx, **({"expiry": expiry} if expiry else {})},
                    sort=[("timestamp", -1)],
                    projection={"_id": 0},
                ),
                timeout=2.0,
            )
        except Exception:
            doc = None
        if doc:
            snap = doc
            if tracker and (not expiry or doc.get("expiry") == tracker.selected_expiry.get(idx)):
                tracker.last_snapshot[idx] = doc
    if not snap:
        raise HTTPException(503, "No data yet")
    return _public_oi_snapshot(snap)


@api_router.get("/public/login-preview/oi")
async def get_login_preview_oi():
    """Return a small NIFTY OI sample for the unauthenticated login preview."""
    idx = "NIFTY"
    market_is_open = tracker.oi_session_open() if tracker else is_market_open()
    current = tracker.last_snapshot.get(idx) if tracker else None
    age = (
        tracker.snapshot_age_seconds(current)
        if tracker and current and hasattr(tracker, "snapshot_age_seconds")
        else None
    )
    if not current or (age is not None and age > 25):
        stored = await _latest_oi_snapshot(idx)
        if stored:
            current = prefer_newer_snapshot(current, stored)
            if tracker and current is stored:
                tracker.last_snapshot[idx] = stored
            if tracker and current and hasattr(tracker, "snapshot_age_seconds"):
                age = tracker.snapshot_age_seconds(current)

    if not current:
        raise HTTPException(503, "No public preview data available")
    if (
        market_is_open
        and tracker
        and hasattr(tracker, "request_background_refresh")
        and (age is None or age > 25)
    ):
        tracker.request_background_refresh(idx)

    allowed_snapshot_fields = ("timestamp", "expiry", "price", "atm")
    preview = {
        key: current[key]
        for key in allowed_snapshot_fields
        if key in current
    }
    preview["index"] = idx
    raw_strikes = current.get("strikes") or []
    try:
        atm = float(current.get("atm"))
        nearby = sorted(
            (row for row in raw_strikes if isinstance(row, dict)),
            key=lambda row: abs(float(row.get("strike")) - atm),
        )[:9]
    except (TypeError, ValueError):
        nearby = [row for row in raw_strikes[:9] if isinstance(row, dict)]
    preview_fields = ("strike", "ce_oi", "pe_oi", "ce_volume", "pe_volume", "ce_ltp", "pe_ltp")
    preview["strikes"] = [
        {key: row[key] for key in preview_fields if key in row}
        for row in sorted(nearby, key=lambda row: float(row.get("strike", 0) or 0))
    ]
    return {
        "index": idx,
        "current": preview,
        "previous": None,
        "data_status": _build_data_status(current, market_is_open, age),
    }


@api_router.get("/expiries/{index_name}")
async def get_expiries(
    index_name: str,
    _who: str = Depends(require_desk_user),
):
    idx = index_name.upper()
    if idx not in INDEX_CONFIG:
        raise HTTPException(404, "Unknown index")
    all_dates = tracker.list_expiries(idx) if tracker else []

    # Cap to the first 8 nearest unexpired (Kite instrument list can span
    # multiple years of monthlies which drowns the UI).
    from datetime import date as _date, datetime as _datetime
    today = now_ist().date()
    parsed_all = []
    for d in all_dates:
        try:
            parsed_all.append(
                _datetime.fromisoformat(d).date()
                if "T" in str(d)
                else _date.fromisoformat(str(d)[:10])
            )
        except Exception:
            continue
    parsed = sorted({p for p in parsed_all if p >= today})[:8]
    if not parsed:
        snap = ((tracker.last_snapshot or {}) if tracker else {}).get(idx) or {}
        snap_dates = []
        for item in (snap.get("expiries") or []):
            try:
                snap_dates.append(_date.fromisoformat(str(item)[:10]))
            except Exception:
                pass
        snap_exp = snap.get("expiry")
        if snap_exp:
            try:
                snap_dates.append(_date.fromisoformat(str(snap_exp)[:10]))
            except Exception:
                pass
        parsed = sorted({p for p in snap_dates if p >= today})[:8]
        if not parsed:
            if not snap_exp:
                try:
                    doc = await asyncio.wait_for(
                        db.oi_snapshots.find_one(
                            {"index": idx},
                            sort=[("timestamp", -1)],
                            projection={"expiry": 1, "expiries": 1, "_id": 0},
                            maxTimeMS=1500,
                        ),
                        timeout=2.0,
                    )
                    for item in (doc or {}).get("expiries") or []:
                        try:
                            parsed.append(_date.fromisoformat(str(item)[:10]))
                        except Exception:
                            pass
                    snap_exp = (doc or {}).get("expiry")
                except Exception:
                    snap_exp = None
            if snap_exp:
                try:
                    parsed = sorted({p for p in parsed + [_date.fromisoformat(str(snap_exp)[:10])] if p >= today})[:8]
                    if not parsed:
                        parsed = [_date.fromisoformat(str(snap_exp)[:10])]
                except Exception:
                    parsed = parsed or []
            elif parsed_all:
                parsed = sorted(set(parsed_all))[-1:]
            else:
                parsed = sorted({p for p in parsed if p})[:8]
    dates = [p.isoformat() for p in parsed]

    from expiry_kind import annotate_expiries

    only_monthlies = idx == "BANKNIFTY"
    meta = annotate_expiries(parsed, idx, today=today)
    if only_monthlies:
        for item in meta:
            item["tag"] = "M"
            item["type"] = "monthly"

    selected = tracker.selected_expiry.get(idx) if tracker else None
    # If tracker still points at a past / missing expiry, surface the nearest live one.
    if selected not in dates:
        selected = dates[0] if dates else None
        if selected:
            try:
                if tracker:
                    tracker.set_expiry(idx, selected)
            except Exception:
                pass

    return {
        "index": idx,
        "expiries": dates,
        "expiries_meta": meta,
        "selected": selected,
        "note": (
            "BANKNIFTY weekly expiries were discontinued by NSE in Nov-2024. "
            "Only monthly (last-Tuesday-of-month) contracts are listed."
            if only_monthlies else None
        ),
    }


@api_router.post("/expiries/{index_name}")
async def set_expiry(index_name: str, payload: ExpiryIn, _admin: bool = Depends(require_admin)):
    idx = index_name.upper()
    if idx not in INDEX_CONFIG:
        raise HTTPException(404, "Unknown index")
    tracker.set_expiry(idx, payload.expiry)
    return {"ok": True, "index": idx, "selected": tracker.selected_expiry.get(idx)}


@api_router.get("/settings")
async def get_settings(reload: bool = Query(False)):
    # Keep weekday alert focus in sync (same as /config) so the desk never
    # reads a stale/null alert_enabled_indices and suppresses toasts.
    # Mongo reload only when Admin configuration asks (?reload=true). The
    # public Dashboard used to hit this every 60s and pin the origin.
    if tracker and reload:
        try:
            await tracker.reload_settings_from_db()
        except Exception:
            pass
    if tracker:
        try:
            tracker._refresh_alert_indices_for_today()
        except Exception:
            pass
    data = dict(_live_settings())
    data.pop("_id", None)
    try:
        from universe import without_paused_mcx, set_mcx_desk_available
        data["mcx_desk_on"] = bool(tracker.settings.get("mcx_desk_on")) if tracker else bool(data.get("mcx_desk_on"))
        if data.get("mcx_desk_on"):
            set_mcx_desk_available(True)
        enabled = list(data.get("enabled_indices") or [])
        if not data.get("mcx_desk_on"):
            enabled = without_paused_mcx(enabled, INDEX_CONFIG)
        data["enabled_indices"] = enabled
        known = []
        if db is not None:
            async for d in db.index_registry.find({"enabled": True}, {"_id": 1}):
                if d.get("_id"):
                    known.append(d["_id"])
        if not known:
            known = list(INDEX_CONFIG.keys())
        if not data.get("mcx_desk_on"):
            known = without_paused_mcx(known, INDEX_CONFIG)
        data["known_indices"] = known
        known_set = set(known)
        _sanitize_settings_catalog_values(data, known_set)
    except Exception:
        data["known_indices"] = list(INDEX_CONFIG.keys())
        _sanitize_settings_catalog_values(data)
    return data


@api_router.post("/settings")
async def update_settings(payload: SettingsIn, _admin: bool = Depends(require_admin)):
    patch = {k: v for k, v in payload.model_dump().items() if v is not None}
    if patch.get("sitewalkthrough_enabled") is True and await _get_maintenance_state():
        raise HTTPException(409, "Site walkthrough cannot be enabled while site maintenance is active")
    if "mcx_desk_on" in patch:
        try:
            from universe import set_mcx_desk_available
            set_mcx_desk_available(bool(patch["mcx_desk_on"]))
        except Exception:
            pass
    # Older clients may submit retired IDs alongside current selections; keep valid
    # values and let required-selection checks reject lists that contain no current IDs.
    _sanitize_settings_catalog_values(patch, fallback_empty=False)
    if (
        "straddle_enabled_indices" in patch
        and payload.straddle_enabled_indices
        and not patch["straddle_enabled_indices"]
    ):
        raise HTTPException(400, "straddle_enabled_indices contains no current indices")
    if "enabled_indices" in patch:
        if not patch["enabled_indices"]:
            raise HTTPException(400, "At least one tracked index is required")
        try:
            from universe import without_paused_mcx
            patch["enabled_indices"] = without_paused_mcx(patch["enabled_indices"], INDEX_CONFIG)
        except Exception:
            pass
        if not patch["enabled_indices"]:
            raise HTTPException(400, "At least one tracked index is required")
        for i in patch["enabled_indices"]:
            if i not in INDEX_CONFIG:
                raise HTTPException(400, f"Unknown index: {i}")
    if "alert_enabled_indices" in patch:
        if not patch["alert_enabled_indices"]:
            raise HTTPException(400, "At least one alert index is required")
        for i in patch["alert_enabled_indices"]:
            if i not in INDEX_CONFIG:
                raise HTTPException(400, f"Unknown alert index: {i}")
    if "straddle_enabled_indices" in patch:
        for i in patch["straddle_enabled_indices"]:
            if i not in INDEX_CONFIG:
                raise HTTPException(400, f"Unknown straddle index: {i}")
    if "visible_pages" in patch:
        pages = list(patch["visible_pages"] or [])
        if not pages:
            raise HTTPException(400, "At least one public dashboard page is required")
        for p in pages:
            if p not in DASHBOARD_PAGE_KEYS:
                raise HTTPException(400, f"Unknown dashboard page: {p}")
        patch["visible_pages"] = pages
    if "admin_visible_pages" in patch:
        pages = list(patch["admin_visible_pages"] or [])
        if not pages:
            raise HTTPException(400, "Keep at least one page on your own dashboard")
        for p in pages:
            if p not in DASHBOARD_PAGE_KEYS:
                raise HTTPException(400, f"Unknown dashboard page: {p}")
        patch["admin_visible_pages"] = pages
    if "oi_poll_interval_seconds" in patch:
        if int(patch["oi_poll_interval_seconds"]) not in (15, 30, 60):
            raise HTTPException(400, "oi_poll_interval_seconds must be 15, 30, or 60")
    if "straddle_poll_interval_seconds" in patch:
        if int(patch["straddle_poll_interval_seconds"]) not in (15, 30, 60, 120):
            raise HTTPException(400, "straddle_poll_interval_seconds must be 15, 30, 60, or 120")
    if "positions_poll_interval_seconds" in patch:
        v = int(patch["positions_poll_interval_seconds"])
        if v < 1 or v > 3600:
            raise HTTPException(400, "positions_poll_interval_seconds must be between 1 and 3600")
        patch["positions_poll_interval_seconds"] = v
    if "position_mark_glow_pct" in patch:
        v = float(patch["position_mark_glow_pct"])
        if v < 0.01 or v > 5:
            raise HTTPException(400, "position_mark_glow_pct must be between 0.01 and 5")
        patch["position_mark_glow_pct"] = v
    for key in ("alert_toast_opacity", "overnight_popup_opacity", "market_intel_popup_opacity", "indicative_popup_opacity"):
        if key not in patch:
            continue
        v = int(patch[key])
        if v < 60 or v > 100:
            raise HTTPException(400, f"{key} must be between 60 and 100")
        patch[key] = v
    if "market_intel_ingest_seconds" in patch:
        v = int(patch["market_intel_ingest_seconds"])
        if v < 60 or v > 3600:
            raise HTTPException(400, "market_intel_ingest_seconds must be 60–3600")
        patch["market_intel_ingest_seconds"] = v
    if "market_intel_retention_days" in patch or "market_intel_min_history_days" in patch:
        s = _live_settings()
        ret_raw = patch["market_intel_retention_days"] if "market_intel_retention_days" in patch else s.get("market_intel_retention_days", 5)
        mn_raw = patch["market_intel_min_history_days"] if "market_intel_min_history_days" in patch else s.get("market_intel_min_history_days", 2)
        ret = int(ret_raw if ret_raw is not None else 5)
        mn = int(mn_raw if mn_raw is not None else 2)
        if mn < 0:
            raise HTTPException(400, "market_intel_min_history_days must be ≥ 0")
        if ret < 0:
            raise HTTPException(400, "market_intel_retention_days must be ≥ 0")
        if ret and mn and ret < mn:
            raise HTTPException(400, "News retention cannot be below minimum historical context days")
        patch["market_intel_retention_days"] = ret
        patch["market_intel_min_history_days"] = mn
    for key in ("market_open_ist", "market_close_ist", "second_session_ist", "cas_iep_start_ist", "cas_iep_end_ist"):
        if key in patch:
            try:
                hh, mm = [int(x) for x in str(patch[key]).split(":")[:2]]
                if not (0 <= hh <= 23 and 0 <= mm <= 59):
                    raise ValueError("range")
                patch[key] = f"{hh:02d}:{mm:02d}"
            except Exception:
                raise HTTPException(400, f"{key} must be HH:MM (IST)")
    if "admin_session_ttl_minutes" in patch:
        v = int(patch["admin_session_ttl_minutes"])
        if v < 30 or v > 24 * 60:
            raise HTTPException(400, "admin_session_ttl_minutes must be between 30 and 1440")
        patch["admin_session_ttl_minutes"] = v
    if "cas_iep_interval_seconds" in patch:
        v = int(patch["cas_iep_interval_seconds"])
        if v < 5 or v > 60:
            raise HTTPException(400, "cas_iep_interval_seconds must be 5–60")
        patch["cas_iep_interval_seconds"] = v
    if "lot_sizes" in patch and isinstance(patch["lot_sizes"], dict):
        clean = {}
        for k, v in patch["lot_sizes"].items():
            try:
                n = int(v)
            except (TypeError, ValueError):
                continue
            if n > 0:
                clean[str(k).upper()] = n
        patch["lot_sizes"] = clean
    out = await tracker.save_settings(patch)
    return _sanitize_settings_catalog_values(dict(out))


class IndexEnableIn(BaseModel):
    name: Optional[str] = None


async def _kite_instrument_rows():
    svc = tracker.kite_service if tracker else None
    if not svc:
        raise HTTPException(503, "Connect your broker to discover instruments")
    try:
        def _rows():
            svc._load_instruments()
            return svc.instrument_rows()

        rows = await asyncio.wait_for(asyncio.to_thread(_rows), timeout=40)
    except Exception as e:
        raise HTTPException(503, _sanitize_public_error(str(e)) or "Data feed temporarily unavailable")
    if not rows:
        raise HTTPException(
            400,
            "Broker instrument list is empty — tap Refresh, wait for the data, then Enable again",
        )
    return rows


@api_router.get("/admin/indices")
async def admin_list_indices(_admin: bool = Depends(require_admin)):
    from index_registry import bootstrap_registry, public_registry_doc

    await bootstrap_registry(db, tracker.settings if tracker else None)
    docs = []
    async for d in db.index_registry.find({}).sort("_id", 1):
        row = public_registry_doc(d)
        try:
            from universe import is_paused_mcx
            if is_paused_mcx(row.get("id") or d.get("_id"), row):
                continue
        except Exception:
            pass
        docs.append(row)
    meta = await db.kite_underlyings_meta.find_one({"_id": "sync"})
    return {
        "indices": docs,
        "enabled": tracker.settings.get("enabled_indices") if tracker else [],
        "synced_at": (meta or {}).get("synced_at"),
        "known": list(INDEX_CONFIG.keys()),
        "mcx_desk_on": bool((tracker.settings or {}).get("mcx_desk_on")) if tracker else False,
    }


@api_router.post("/admin/indices/sync")
async def admin_sync_instruments(_admin: bool = Depends(require_admin)):
    from index_registry import persist_underlyings, summarize_underlyings

    rows = await _kite_instrument_rows()
    summaries = summarize_underlyings(rows, q="", limit=None)
    n = await persist_underlyings(db, summaries)
    try:
        lots = dict((tracker.settings or {}).get("lot_sizes") or {})
        for s in summaries:
            uid = s.get("id")
            ls = int(s.get("lot_size") or 0)
            if uid and ls > 0 and not lots.get(uid):
                lots[uid] = ls
        if lots:
            await tracker.save_settings({"lot_sizes": lots})
    except Exception:
        logger.warning("lot_sizes merge on index sync failed", exc_info=True)
    return {"ok": True, "count": n, "lot_sizes": dict((tracker.settings or {}).get("lot_sizes") or {})}


@api_router.get("/admin/indices/search")
async def admin_search_indices(
    q: str = "",
    limit: int = 40,
    _admin: bool = Depends(require_admin),
):
    from index_registry import persist_underlyings, search_cached, summarize_underlyings

    cached, synced_at = await search_cached(db, q, limit)
    if cached:
        return {"results": cached, "synced_at": synced_at, "source": "cache"}
    rows = await _kite_instrument_rows()
    summaries = summarize_underlyings(rows, q=q, limit=limit)
    try:
        all_sum = summarize_underlyings(rows, q="", limit=None)
        await persist_underlyings(db, all_sum)
    except Exception:
        pass
    return {"results": summaries, "synced_at": None, "source": "kite"}


@api_router.get("/admin/indices/inspect")
async def admin_inspect_index(name: str, _admin: bool = Depends(require_admin)):
    from index_registry import inspect_underlying

    if not (name or "").strip():
        raise HTTPException(400, "name required")
    rows = await _kite_instrument_rows()
    info = inspect_underlying(rows, name)
    existing = await db.index_registry.find_one({"_id": info["id"]})
    info["enabled"] = bool(existing and existing.get("enabled"))
    return info


@api_router.post("/admin/indices/{name}/enable")
async def admin_enable_index(
    name: str,
    request: Request,
    _admin: bool = Depends(require_admin),
):
    from index_registry import (
        extra_poll_cfg,
        inspect_underlying,
        merge_live_index_config,
        public_registry_doc,
        write_audit,
    )
    from universe import DESK_IDS, MCX_MAJOR_IDS, is_paused_mcx

    key = name.strip().upper()
    try:
        rows = await _kite_instrument_rows()
        info = inspect_underlying(rows, key)
        if is_paused_mcx(key, (info or {}).get("config")):
            raise HTTPException(400, "Turn on the MCX desk toggle first, then Enable this commodity")
        if not info.get("can_enable_oi") or not info.get("config"):
            raise HTTPException(400, info.get("notes") or "Cannot enable OI analytics for this instrument")
        prev = await db.index_registry.find_one({"_id": key})
        now_iso = datetime.now(timezone.utc).isoformat()
        cfg = info["config"]
        doc = {
            "name": cfg.get("name") or key,
            "display_name": info.get("display_name") or key,
            "symbol": key,
            "exchange": info.get("exchange") or cfg.get("exchange"),
            "quote_symbol": cfg["quote_symbol"],
            "quote_kind": cfg.get("quote_kind") or "index",
            "segment": cfg["segment"],
            "step": cfg["step"],
            "strikes_around_atm": cfg["strikes_around_atm"],
            "calendar": cfg.get("calendar"),
            "session_group": cfg.get("session_group"),
            "enabled": True,
            "capabilities": info.get("capabilities"),
            "updated_at": now_iso,
            "created_at": (prev or {}).get("created_at") or now_iso,
        }
        ls = int(info.get("lot_size") or (prev or {}).get("lot_size") or 0)
        if ls > 0:
            doc["lot_size"] = ls
        await db.index_registry.update_one({"_id": key}, {"$set": doc}, upsert=True)
        extra = {}
        async for d in db.index_registry.find({}):
            if d["_id"] in DESK_IDS:
                continue
            cfg_row = extra_poll_cfg(d)
            if cfg_row:
                extra[d["_id"]] = cfg_row
        merge_live_index_config(extra)
        enabled = list(tracker.settings.get("enabled_indices") or [])
        if key not in enabled:
            enabled.append(key)
        patch = {"enabled_indices": enabled}
        if ls > 0:
            lots = dict(tracker.settings.get("lot_sizes") or {})
            lots[key] = ls
            patch["lot_sizes"] = lots
        if key in MCX_MAJOR_IDS:
            patch["mcx_desk_on"] = True
            try:
                from universe import set_mcx_desk_available
                set_mcx_desk_available(True)
            except Exception:
                pass
        await tracker.save_settings(patch)
        tracker.ensure_index_slots([key])
        try:
            if tracker.kite_service:
                await asyncio.wait_for(
                    asyncio.to_thread(tracker.kite_service.reload_instruments, True),
                    timeout=40,
                )
                await tracker.seed_default_expiries()
        except Exception as e:
            logger.warning("reload after enable %s: %s", key, e)
        sess = await _admin_from_request(request)
        try:
            await write_audit(
                db, action="index_enable", index=key, admin=(sess or {}).get("username"), prev=prev, new=doc
            )
        except Exception:
            logger.warning("index_enable audit failed for %s", key, exc_info=True)
        stored = await db.index_registry.find_one({"_id": key})
        return {"ok": True, "index": public_registry_doc(stored), "enabled_indices": enabled, "mcx_desk_on": bool(tracker.settings.get("mcx_desk_on"))}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("enable index %s failed", key)
        raise HTTPException(500, f"Enable failed: {e}")


@api_router.post("/admin/indices/{name}/disable")
async def admin_disable_index(
    name: str,
    request: Request,
    _admin: bool = Depends(require_admin),
):
    from index_registry import public_registry_doc, write_audit
    from universe import DESK_IDS

    key = name.strip().upper()
    enabled = [i for i in (tracker.settings.get("enabled_indices") or []) if i != key]
    if not enabled:
        raise HTTPException(400, "Keep at least one tracked index")
    prev = await db.index_registry.find_one({"_id": key})
    now_iso = datetime.now(timezone.utc).isoformat()
    await db.index_registry.update_one(
        {"_id": key},
        {"$set": {"enabled": False, "updated_at": now_iso}},
        upsert=True,
    )
    alerts = [i for i in (tracker.settings.get("alert_enabled_indices") or []) if i != key]
    strad = [i for i in (tracker.settings.get("straddle_enabled_indices") or []) if i != key]
    await tracker.save_settings({
        "enabled_indices": enabled,
        "alert_enabled_indices": alerts or enabled[:1],
        "straddle_enabled_indices": strad,
    })
    sess = await _admin_from_request(request)
    stored = await db.index_registry.find_one({"_id": key})
    await write_audit(
        db,
        action="index_disable",
        index=key,
        admin=(sess or {}).get("username"),
        prev=prev,
        new=stored,
    )
    return {"ok": True, "index": public_registry_doc(stored), "enabled_indices": enabled, "desk": key in DESK_IDS, "mcx_desk_on": bool(tracker.settings.get("mcx_desk_on"))}


def _session_open_utc_for_anchor(anchor: datetime) -> datetime:
    """Return today's NSE session-open (09:15 IST) in UTC for the anchor's IST day.

    Change windows must never reach into the previous trading day — that made
    Full-Day / pre-open deltas look like "yesterday's OI pulled into today".
    """
    anchor_ist = anchor.astimezone(IST) if anchor.tzinfo else anchor.replace(tzinfo=timezone.utc).astimezone(IST)
    session_open_ist = anchor_ist.replace(
        hour=MARKET_OPEN.hour, minute=MARKET_OPEN.minute, second=0, microsecond=0
    )
    return session_open_ist.astimezone(timezone.utc)


def _session_elapsed_minutes(current_ts: str) -> int:
    """Minutes from session open (clamped) to the snapshot timestamp — for whole-day bias."""
    try:
        anchor = datetime.fromisoformat(current_ts)
    except Exception:
        anchor = datetime.now(timezone.utc)
    session_open = _session_open_utc_for_anchor(anchor)
    elapsed = max(1.0, (anchor - session_open).total_seconds() / 60.0)
    return min(1440, int(math.ceil(elapsed)))


async def _latest_oi_snapshot(idx: str, expiry: Optional[str] = None) -> Optional[dict]:
    """Newest stored chain for this index (optional expiry). Never hits Kite."""
    if db is None:
        return None
    filt = {"index": idx, **({"expiry": expiry} if expiry else {})}
    try:
        return await asyncio.wait_for(
            db.oi_snapshots.find_one(
                filt,
                sort=[("timestamp", -1)],
                projection={"_id": 0},
                maxTimeMS=1500,
            ),
            timeout=2.0,
        )
    except TypeError:
        try:
            return await asyncio.wait_for(
                db.oi_snapshots.find_one(filt, sort=[("timestamp", -1)], projection={"_id": 0}),
                timeout=2.0,
            )
        except Exception:
            return None
    except Exception:
        return None


async def _oi_snapshot_find_one(filt: dict, sort_dir: int):
    """One oi_snapshots row. sort_dir: 1 oldest, -1 newest. Never hits Kite."""
    if db is None:
        return None
    sort = [("timestamp", sort_dir)]
    try:
        return await asyncio.wait_for(
            db.oi_snapshots.find_one(
                filt, sort=sort, projection={"_id": 0}, maxTimeMS=2500,
            ),
            timeout=3.0,
        )
    except TypeError:
        try:
            return await asyncio.wait_for(
                db.oi_snapshots.find_one(filt, sort=sort, projection={"_id": 0}),
                timeout=3.0,
            )
        except Exception:
            return None
    except Exception:
        return None


async def _find_previous_snapshot(
    idx: str,
    current_ts: str,
    minutes: int,
    expiry: Optional[str],
) -> tuple:
    """Baseline for Change-in-OI: snapshot at or before now−N (session-open floor).

    Sliding window — 15 min at 10:29:45 uses ~10:14:45; next poll at 10:30 uses
    ~10:15. Does not wait to accumulate N minutes after a restart.
    """
    try:
        anchor = datetime.fromisoformat(current_ts)
    except Exception:
        anchor = datetime.now(timezone.utc)
    if anchor.tzinfo is None:
        anchor = anchor.replace(tzinfo=timezone.utc)
    session_open = _session_open_utc_for_anchor(anchor)
    floor = lookback_floor(anchor, minutes, session_open)

    base = {"index": idx}
    if expiry:
        base["expiry"] = expiry

    # Prefer the last tick at or before the lookback instant (true now−N).
    prev_doc = await _oi_snapshot_find_one(
        {**base, "timestamp": {"$gte": session_open.isoformat(), "$lte": floor.isoformat()}},
        -1,
    )
    # Gap at exactly now−N: take the first tick after the floor, still before now.
    if not prev_doc:
        prev_doc = await _oi_snapshot_find_one(
            {**base, "timestamp": {"$gt": floor.isoformat(), "$lt": current_ts}},
            1,
        )

    history_ready = prev_doc is not None
    elapsed_min_val: Optional[float] = None
    if prev_doc and current_ts:
        try:
            prev_ts_dt = datetime.fromisoformat(prev_doc.get("timestamp"))
            cur_ts_dt = datetime.fromisoformat(current_ts)
            elapsed_min_val = (cur_ts_dt - prev_ts_dt).total_seconds() / 60.0
        except Exception:
            pass

    return prev_doc, history_ready, round(elapsed_min_val, 2) if elapsed_min_val is not None else 0.0


def _stale_threshold_seconds() -> int:
    """Dynamic STALE threshold from poll cadence (avoids false STALE between ticks)."""
    try:
        if tracker and hasattr(tracker, "stale_after_seconds"):
            return int(tracker.stale_after_seconds())
    except Exception:
        pass
    return 90


def _build_data_status(current: dict, market_is_open: bool, age_seconds: Optional[float]) -> dict:
    """Truth layer for clients: LIVE vs LAST SESSION vs OFFLINE — never ambiguous."""
    mode = tracker.mode if tracker else "offline"
    thr = _stale_threshold_seconds()
    stale_reason = None
    is_live = False
    if mode != "kite":
        stale_reason = "publisher_feed_unavailable"
    elif not market_is_open:
        stale_reason = "market_closed"
    elif age_seconds is None:
        stale_reason = "no_timestamp"
    elif age_seconds > thr:
        stale_reason = "stale_cache"
    else:
        is_live = True

    data_date = None
    as_of = None
    as_of_ist = None
    try:
        if current and current.get("timestamp"):
            as_of = current["timestamp"]
            ts = datetime.fromisoformat(current["timestamp"])
            if ts.tzinfo is None:
                ts = ts.replace(tzinfo=timezone.utc)
            ist_ts = ts.astimezone(IST)
            data_date = ist_ts.date().isoformat()
            as_of_ist = ist_ts.strftime("%H:%M:%S")
    except Exception:
        data_date = None
        as_of_ist = None

    if is_live:
        label = "LIVE"
    elif mode != "kite":
        label = "OFFLINE"
    elif not market_is_open:
        label = "LAST_SESSION"
    else:
        label = "STALE"

    return {
        "is_live": is_live,
        "stale_reason": stale_reason,
        "data_date": data_date,
        "cache_age_seconds": round(age_seconds, 1) if age_seconds is not None else None,
        "stale_after_seconds": thr,
        "as_of": as_of,
        "as_of_ist": as_of_ist,
        "label": label,
        "market_open": bool(market_is_open),
    }


@api_router.get("/oi/{index_name}/change")
async def get_oi_change(
    index_name: str,
    minutes: int = Query(15, ge=1, le=1440),
    expiry: Optional[str] = None,
    also: Optional[str] = Query(None, description="Comma-separated extra windows e.g. 1,3,5"),
    _who: str = Depends(require_desk_user),
):
    """Return current snapshot plus a time-based baseline snapshot for diffing.

    Efficiency contract:
      * Never hits Kite inline (avoids N-client stampede). Background poller is
        the sole writer; if cache is stale we kick a single-flight refresh and
        still return the latest known snapshot immediately.
      * GET never mutates tracker.selected_expiry.
      * Lookback is the snapshot at or before now−N (clamped to today's session
        open). The window slides every poll — it does not wait to accumulate N
        minutes after a restart.
      * `also=1,3,5` returns extra baselines in one round-trip (huge-shift).
    """
    idx = index_name.upper()
    if idx not in INDEX_CONFIG:
        raise HTTPException(404, "Unknown index")

    market_is_open = tracker.oi_session_open() if tracker else is_market_open()
    current = tracker.last_snapshot.get(idx) if tracker else None

    # Expiry filter only — never call set_expiry from GET.
    if current and expiry and current.get("expiry") != expiry:
        current = None

    age = None
    if tracker and current and hasattr(tracker, "snapshot_age_seconds"):
        age = tracker.snapshot_age_seconds(current)
    STALE_THRESHOLD_SECONDS = 25
    # Re-read Mongo whenever memory is missing OR older than one poll — including
    # while the market is open. Another worker (or this process after a stall)
    # may already have a newer tick persisted; serving stale last_snapshot made
    # OI Change look frozen until the user switched timeframe (new request).
    needs_db = (not current) or (age is not None and age > STALE_THRESHOLD_SECONDS)

    if needs_db:
        doc = await _latest_oi_snapshot(idx, expiry)
        if doc:
            current = prefer_newer_snapshot(current, doc)
            if tracker and current is doc and (
                not expiry
                or doc.get("expiry") == tracker.selected_expiry.get(idx)
                or tracker.selected_expiry.get(idx) is None
            ):
                tracker.last_snapshot[idx] = doc
            if tracker and current and hasattr(tracker, "snapshot_age_seconds"):
                age = tracker.snapshot_age_seconds(current)

    if not current:
        raise HTTPException(
            503,
            f"No data available for {idx}"
            + (" — market is closed and no cached snapshot yet." if not market_is_open else ""),
        )

    # If cache is stale while market is open, kick ONE background refresh —
    # do not block this request on Kite.
    if market_is_open and tracker and hasattr(tracker, "request_background_refresh"):
        if age is None or age > STALE_THRESHOLD_SECONDS:
            tracker.request_background_refresh(idx, expiry=expiry)

    current_ts = current.get("timestamp")
    if not current_ts:
        raise HTTPException(503, "No current data")

    extra_mins = []
    if also:
        for part in also.split(","):
            part = part.strip()
            if not part or part.lower() == "session":
                continue
            try:
                m = int(part)
                if 1 <= m <= 1440 and m != minutes:
                    extra_mins.append(m)
            except ValueError:
                continue

    sess_m = _session_elapsed_minutes(current_ts)
    # Timeframe + session + huge-shift lookbacks in parallel — serial full-chain
    # Mongo reads were pinning /change (and the rest of the API) for 20s+.
    jobs = [("prev", minutes, None)]
    if sess_m != minutes:
        jobs.append(("session", sess_m, {"label": "session"}))
    seen = {minutes, sess_m}
    for m in extra_mins:
        if m in seen:
            continue
        seen.add(m)
        jobs.append((str(m), m, {}))

    async def _lookback_job(key: str, lookback: int, extra: Optional[dict]):
        p, ready, avail = await _find_previous_snapshot(idx, current_ts, lookback, expiry)
        payload = {
            "previous": p,
            "minutes": lookback,
            "history_ready": ready,
            "available_history_minutes": avail,
        }
        if extra:
            payload.update(extra)
        return key, payload

    gathered = await asyncio.gather(
        *[_lookback_job(k, m, extra) for k, m, extra in jobs],
        return_exceptions=True,
    )
    also_windows: Dict[str, Any] = {}
    prev_doc = None
    history_ready = False
    available_min = 0.0
    for item in gathered:
        if isinstance(item, Exception):
            logger.warning("[get_oi_change] lookback failed: %s", item)
            continue
        key, payload = item
        if key == "prev":
            prev_doc = payload["previous"]
            history_ready = payload["history_ready"]
            available_min = payload["available_history_minutes"]
            continue
        also_windows[key] = payload
    if "session" not in also_windows:
        also_windows["session"] = {
            "previous": prev_doc,
            "minutes": sess_m,
            "history_ready": history_ready,
            "available_history_minutes": available_min,
            "label": "session",
        }

    return {
        "index": idx,
        "current": _public_oi_snapshot(current),
        "previous": _public_oi_snapshot(prev_doc),
        "minutes": minutes,
        "history_ready": history_ready,
        "available_history_minutes": available_min,
        "also_windows": {
            key: {**window, "previous": _public_oi_snapshot(window.get("previous"))}
            for key, window in also_windows.items()
        },
        "data_status": _build_data_status(current, market_is_open, age),
    }


@api_router.get("/history/{index_name}")
async def get_history(
    index_name: str,
    minutes: int = Query(60, ge=1, le=1440),
    _who: str = Depends(require_desk_user),
):
    """Return OI snapshot history for Replay.

    While the market is open: last `minutes` of wall-clock time.
    When closed (post-close / weekend / holiday / pre-open): serve the
    last trading session (session_anchor_date), optionally trimmed to the
    last `minutes` of that session so weekend users still see Friday's data.
    """
    idx = index_name.upper()
    if idx not in INDEX_CONFIG:
        raise HTTPException(404, "Unknown index")

    now_utc = datetime.now(timezone.utc)
    market_open = tracker.oi_session_open() if tracker else is_market_open()

    if market_open:
        cutoff = (now_utc - timedelta(minutes=minutes)).isoformat()
        docs = await db.oi_snapshots.find(
            {"index": idx, "timestamp": {"$gte": cutoff, "$lte": now_utc.isoformat()}},
            {"_id": 0},
        ).sort("timestamp", 1).to_list(length=5000)
        return {
            "index": idx,
            "count": len(docs),
            "history": [_public_oi_snapshot(doc) for doc in docs],
            "session_anchor_date": session_anchor_date().isoformat(),
            "source": "live_window",
        }

    # Closed: resolve last trading session and serve that day's ticks.
    anchor = session_anchor_date()
    start_utc, end_utc = session_window_utc(anchor)
    # If post-close same day, end at now (final tick may be slightly after display close).
    if end_utc > now_utc:
        end_utc = now_utc
    query = {
        "index": idx,
        "timestamp": {"$gte": start_utc.isoformat(), "$lte": end_utc.isoformat()},
    }
    docs = await db.oi_snapshots.find(query, {"_id": 0}).sort("timestamp", 1).to_list(length=5000)

    # Trim to last N minutes of the session if requested window is shorter than the full day.
    if docs and minutes < 24 * 60:
        try:
            last_ts = datetime.fromisoformat(docs[-1]["timestamp"].replace("Z", "+00:00"))
            trim_from = (last_ts - timedelta(minutes=minutes)).isoformat()
            docs = [d for d in docs if d.get("timestamp", "") >= trim_from]
        except Exception:
            pass

    # Absolute fallback: most recent snapshots in retention window.
    if not docs:
        cutoff = (now_utc - timedelta(hours=96)).isoformat()
        docs = await db.oi_snapshots.find(
            {"index": idx, "timestamp": {"$gte": cutoff}},
            {"_id": 0},
        ).sort("timestamp", 1).to_list(length=5000)

    return {
        "index": idx,
        "count": len(docs),
        "history": [_public_oi_snapshot(doc) for doc in docs],
        "session_anchor_date": anchor.isoformat(),
        "source": "last_session",
    }


@api_router.get("/vrp/{index_name}")
async def get_vrp(
    index_name: str,
    days: int = Query(30, ge=5, le=90),
    _who: str = Depends(require_desk_user),
):
    """Volatility Risk Premium for an index (IV - Historical Vol).

    Uses Kite historical_data (daily OHLC) to compute HV_10, HV_20 and
    Parkinson high-low HV. Compares against the current India VIX (from
    tracker.last_snapshot[idx].vix) to produce VRP and a rolling series
    for the sparkline.

    Requires Kite credentials — in mock mode returns an empty-shape response
    with an `error` field so the frontend can degrade gracefully.
    """
    idx = index_name.upper()
    if idx not in INDEX_CONFIG:
        raise HTTPException(404, "Unknown index")

    # Resolve current IV (India VIX). We prefer the most recent snapshot's vix
    # value; fall back to any index's vix if the target index hasn't polled.
    iv_pct: Optional[float] = None
    snap = tracker.last_snapshot.get(idx) if tracker else None
    if snap and snap.get("vix"):
        iv_pct = float(snap["vix"])
    else:
        if tracker:
            for k in ("NIFTY", "SENSEX", "BANKNIFTY"):
                s = tracker.last_snapshot.get(k)
                if s and s.get("vix"):
                    iv_pct = float(s["vix"])
                    break

    if not tracker or tracker.mode != "kite" or not tracker.kite_service:
        return {
            "index": idx,
            "iv": iv_pct,
            "vrp": None,
            "regime": "unknown",
            "label": "Needs broker login",
            "tone": "slate",
            "series": [],
            "error": "market_feed_unavailable",
        }
    if not getattr(tracker.kite_service, "_loaded", False):
        return {
            "index": idx,
            "iv": iv_pct,
            "vrp": None,
            "regime": "unknown",
            "label": "—",
            "tone": "slate",
            "series": [],
            "error": "instruments_not_ready",
        }

    return await compute_vrp(tracker.kite_service, db, idx, iv_pct, days=days)


@api_router.get("/straddle/{index_name}/tick")
async def get_straddle_tick(
    index_name: str,
    expiry: Optional[str] = None,
    _who: str = Depends(require_desk_user),
):
    """Lightweight ATM straddle tick for the intraday chart (spot + CE + PE)."""
    idx = index_name.upper()
    if idx not in INDEX_CONFIG:
        raise HTTPException(404, "Unknown index")

    interval = clamp_straddle_poll_seconds(tracker.settings if tracker else None)

    # Prefer sampler cache when fresh — avoids N clients × Kite quotes.
    cached_q = getattr(tracker, "last_straddle_quote", {}).get(idx)
    if (
        cached_q
        and _is_recent_straddle_sample(
            {"timestamp": cached_q.get("ts")},
            interval + 2,
        )
        and (not expiry or cached_q.get("expiry") == expiry)
    ):
        return {
            "index": idx,
            "ts": cached_q.get("ts"),
            "atm": cached_q.get("atm"),
            "underlying": cached_q.get("underlying"),
            "strike": cached_q.get("atm"),
            "ce_ltp": cached_q.get("ce_ltp"),
            "pe_ltp": cached_q.get("pe_ltp"),
            "premium": cached_q.get("premium"),
            "expiry": cached_q.get("expiry"),
            "cached": True,
        }

    snap = None
    try:
        svc = tracker._get_service() if tracker else None
        exp = expiry or (tracker.selected_expiry.get(idx) if tracker else None)
        if svc and getattr(svc, "_loaded", False) and hasattr(svc, "get_atm_straddle_quote"):
            snap = await asyncio.to_thread(svc.get_atm_straddle_quote, idx, exp)
        if (
            not _is_recent_straddle_sample(snap, _straddle_fallback_max_age_seconds())
            or (expiry and snap.get("expiry") != expiry)
        ):
            snap = None
        if not snap:
            cached = tracker.last_snapshot.get(idx) if tracker else None
            if (
                cached
                and _is_recent_straddle_sample(cached, _straddle_fallback_max_age_seconds())
                and (not expiry or cached.get("expiry") == expiry)
            ):
                snap = cached
    except Exception as e:
        logger.exception("get_straddle_tick failed for %s", idx)
        raise HTTPException(503, _sanitize_public_error(str(e)) or "Data feed temporarily unavailable")

    if not snap:
        raise HTTPException(503, "No fresh data yet for straddle")

    atm = int(snap.get("atm") or 0)
    price = float(snap.get("price") or 0.0)
    if snap.get("ce_ltp") is not None and snap.get("pe_ltp") is not None:
        ce_p = float(snap.get("ce_ltp") or 0)
        pe_p = float(snap.get("pe_ltp") or 0)
    else:
        strike_obj = None
        for s in snap.get("strikes", []):
            if int(s.get("strike")) == atm:
                strike_obj = s
                break
        ce_p = float(strike_obj.get("ce_ltp", 0) if strike_obj else 0)
        pe_p = float(strike_obj.get("pe_ltp", 0) if strike_obj else 0)
    premium = round(ce_p + pe_p, 2)
    try:
        await _persist_straddle_sample(idx, {
            **snap,
            "atm": atm,
            "price": price,
            "ce_ltp": ce_p,
            "pe_ltp": pe_p,
            "premium": premium,
        })
    except Exception:
        pass
    return {
        "index": idx,
        "ts": snap.get("timestamp") or snap.get("ts"),
        "atm": atm,
        "underlying": round(price, 2),
        "strike": atm,
        "ce_ltp": round(ce_p, 2),
        "pe_ltp": round(pe_p, 2),
        "premium": premium,
        "expiry": snap.get("expiry"),
    }


@api_router.get("/straddle/{index_name}")
async def get_straddle(
    index_name: str,
    expiry: Optional[str] = None,
    position: str = Query("long"),
    qty: int = Query(1, ge=1),
    span_steps: Optional[int] = Query(None, ge=4),
    points: int = Query(81, ge=5, le=801),
    _who: str = Depends(require_desk_user),
):
    """Return a straddle payoff series for the ATM strike.

    - `position`: "long" or "short"
    - `qty`: multiplier for the payoff
    - `span_steps`: optional number of strike steps each side to include (defaults to ~20)
    - `points`: number of points in the price grid (default 81)
    """
    idx = index_name.upper()
    if idx not in INDEX_CONFIG:
        raise HTTPException(404, "Unknown index")

    # Fetch a fresh snapshot if we don't have one cached
    snap = tracker.last_snapshot.get(idx) if tracker else None
    if not snap or (expiry and snap.get("expiry") != expiry):
        try:
            svc = tracker._get_service() if tracker else None
            if not svc or not getattr(svc, "_loaded", False):
                # Fall back to DB cache when offline / dump not ready.
                doc = await asyncio.wait_for(
                    db.oi_snapshots.find_one(
                        {"index": idx, **({"expiry": expiry} if expiry else {})},
                        sort=[("timestamp", -1)],
                        projection={"_id": 0},
                        maxTimeMS=1500,
                    ),
                    timeout=2.0,
                )
                if doc:
                    snap = doc
                else:
                    raise HTTPException(503, "No data yet for straddle calculation")
            else:
                # Prefer lightweight ATM quote for premium; fall back to full chain.
                if hasattr(svc, "get_atm_straddle_quote"):
                    snap = await asyncio.to_thread(
                        svc.get_atm_straddle_quote, idx, expiry or tracker.selected_expiry.get(idx)
                    )
                if not snap:
                    snap = await asyncio.to_thread(svc.get_snapshot, idx, expiry or tracker.selected_expiry.get(idx))
                if snap:
                    snap["mode"] = tracker.mode
                    if snap.get("strikes") and len(snap.get("strikes") or []) > 1:
                        tracker.last_snapshot[idx] = snap
        except HTTPException:
            raise
        except Exception as e:
            logger.exception("get_straddle live fetch failed for %s", idx)
            raise HTTPException(503, _sanitize_public_error(str(e)) or "Data feed temporarily unavailable")

    if not snap:
        raise HTTPException(503, "No data yet for straddle calculation")

    atm = int(snap.get("atm") or 0)
    price = float(snap.get("price") or 0.0)
    step = INDEX_CONFIG[idx]["step"]
    # default span: 20 strikes on each side
    steps = span_steps if span_steps is not None else 20
    left = atm - steps * step
    right = atm + steps * step

    # find best matching strike in snapshot (fallback to atm)
    strike_obj = None
    for s in snap.get("strikes", []):
        if int(s.get("strike")) == atm:
            strike_obj = s
            break
    if not strike_obj:
        # pick the closest available strike
        strikes_list = sorted([int(s.get("strike")) for s in snap.get("strikes", []) if s.get("strike") is not None])
        if strikes_list:
            closest = min(strikes_list, key=lambda x: abs(x - atm))
            for s in snap.get("strikes", []):
                if int(s.get("strike")) == closest:
                    strike_obj = s
                    atm = closest
                    break

    if snap.get("ce_ltp") is not None and snap.get("pe_ltp") is not None and not strike_obj:
        ce_p = float(snap.get("ce_ltp") or 0)
        pe_p = float(snap.get("pe_ltp") or 0)
    else:
        ce_p = float(strike_obj.get("ce_ltp", 0) if strike_obj else snap.get("ce_ltp") or 0)
        pe_p = float(strike_obj.get("pe_ltp", 0) if strike_obj else snap.get("pe_ltp") or 0)
    premium = ce_p + pe_p

    # build price grid
    start = max(0.0, left)
    end = right
    series = []
    for i in range(points):
        p = start + (end - start) * (i / (points - 1))
        # payoff for long straddle = max(p-K,0) + max(K-p,0) - premium
        intrinsic = max(p - atm, 0.0) + max(atm - p, 0.0)
        pnl_per = intrinsic - premium
        if position == "short":
            pnl_per = -pnl_per
        pnl = pnl_per * qty
        series.append({"price": round(p, 2), "pnl": round(pnl, 2)})

    return {
        "index": idx,
        "atm": atm,
        "underlying": round(price, 2),
        "strike": atm,
        "ce_ltp": round(ce_p, 2),
        "pe_ltp": round(pe_p, 2),
        "premium": round(premium, 2),
        "position": position,
        "qty": qty,
        "series": series,
    }


def _previous_trading_day(now_ist: datetime) -> date:
    return previous_trading_day(now_ist)


def _resolve_straddle_trade_date(requested_date: Optional[str] = None) -> date:
    now = datetime.now(IST)
    if requested_date and requested_date not in ("auto", "latest"):
        try:
            return date.fromisoformat(requested_date)
        except ValueError:
            raise HTTPException(400, "Invalid date format for trade_date; expected YYYY-MM-DD")
    # Weekend / holiday / pre-open → last completed session.
    # Open or post-close on a trading day → today.
    return session_anchor_date(now)


def _parse_straddle_ts(value) -> Optional[datetime]:
    """Parse a straddle sample timestamp into an aware UTC datetime."""
    if value is None:
        return None
    if isinstance(value, (int, float)):
        # ms vs seconds heuristic
        ts = float(value)
        if ts > 1e12:
            ts = ts / 1000.0
        return datetime.fromtimestamp(ts, tz=timezone.utc)
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    try:
        text = str(value).replace("Z", "+00:00")
        dt = datetime.fromisoformat(text)
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except Exception:
        return None


def _is_recent_straddle_sample(
    snap: Optional[dict],
    max_age_seconds: int,
    now: Optional[datetime] = None,
) -> bool:
    """Keep fallback OI snapshots from being relabeled as current straddle ticks."""
    if not isinstance(snap, dict):
        return False
    timestamp = _parse_straddle_ts(snap.get("timestamp") or snap.get("ts"))
    if timestamp is None:
        return False
    age = ((now or datetime.now(timezone.utc)) - timestamp).total_seconds()
    return 0 <= age <= max_age_seconds


def _straddle_fallback_max_age_seconds() -> int:
    """Allow one configured source cadence plus jitter for OI-backed fallback."""
    oi_interval = (
        tracker.effective_oi_poll_seconds()
        if tracker and hasattr(tracker, "effective_oi_poll_seconds")
        else clamp_oi_poll_seconds(tracker.settings if tracker else None)
    )
    straddle_interval = clamp_straddle_poll_seconds(tracker.settings if tracker else None)
    return max(oi_interval, straddle_interval) + 2


def _filter_straddle_session_docs(docs: list, trade_date: date) -> list:
    """Keep only samples inside the NSE session (09:15–15:40 IST) for trade_date.

    Drops overnight / prior-close points that would otherwise draw a diagonal
    gap on the intraday straddle chart. Allows a 1-minute pre-open poll tick
    (09:15) and clamps pre-open data to 09:15 so the series starts at market open.
    """
    start_utc, end_utc = session_window_utc(trade_date)
    preopen_utc = start_utc - timedelta(minutes=1)
    out = []
    for doc in docs or []:
        ts = _parse_straddle_ts(doc.get("ts") or doc.get("created_at"))
        if ts is None:
            continue
        if ts < preopen_utc or ts > end_utc:
            continue
        if ts < start_utc:
            clamped = dict(doc)
            clamped["ts"] = start_utc.isoformat()
            out.append(clamped)
        else:
            out.append(doc)
    return out


@api_router.get("/straddle/{index_name}/history")
async def get_straddle_history(
    index_name: str,
    minutes: Optional[int] = Query(None, ge=1, le=24*60),
    expiry: Optional[str] = None,
    date: Optional[str] = None,
    _who: str = Depends(require_desk_user),
):
    idx = index_name.upper()
    if idx not in INDEX_CONFIG:
        raise HTTPException(404, "Unknown index")
    active_tracker = _require_tracker()
    target_date = _resolve_straddle_trade_date(date)
    query = {"index": idx, "trade_date": target_date.isoformat()}
    if expiry:
        query["expiry"] = expiry
    # Only apply a rolling wall-clock minutes filter while the market is open.
    # On weekends/holidays/post-close, return the full last-session samples.
    if minutes is not None and minutes < 24 * 60 and active_tracker.oi_session_open():
        cutoff = (datetime.now(timezone.utc) - timedelta(minutes=minutes)).isoformat()
        query["created_at"] = {"$gte": cutoff}
    docs = await db.straddle_samples.find(query, {"_id": 0}).sort("ts", 1).to_list(length=(minutes * 120) if minutes else 5000)

    # If empty (weekend/holiday after 09:15, or missing samples), fall back to previous trading day.
    if not docs and date is None:
        previous_date = _previous_trading_day(datetime.now(IST))
        if previous_date.isoformat() != query.get("trade_date"):
            query["trade_date"] = previous_date.isoformat()
            query.pop("created_at", None)
            docs = await db.straddle_samples.find(query, {"_id": 0}).sort("ts", 1).to_list(length=5000)
            target_date = previous_date

    # Intraday chart only — never return overnight / prior-close points.
    docs = _filter_straddle_session_docs(docs, target_date)

    return {"index": idx, "trade_date": target_date.isoformat(), "count": len(docs), "history": docs}


@api_router.websocket("/ws/straddle/{index_name}")
async def ws_straddle(websocket: WebSocket, index_name: str, expiry: Optional[str] = None, position: str = Query("long"), qty: int = Query(1)):
    """Public WebSocket streaming ATM straddle premium for the intraday chart.

    Message format: { ts, premium, underlying, atm, ce_ltp, pe_ltp }
    No credentials in payloads. Optional admin_token is accepted but not required
    — straddle is a public page (same as FinanceDeft).
    """
    await websocket.accept()
    idx = index_name.upper()
    if idx not in INDEX_CONFIG:
        await websocket.close(code=1003)
        return

    # Optional session bump (admin); guests/anonymous still get the public feed.
    try:
        qs = websocket.scope.get("query_string", b"").decode()
        params = dict((pair.split("=", 1) if "=" in pair else (pair, "")) for pair in qs.split("&") if pair)
        token = (params.get("admin_token") or params.get("token") or "").strip()
        if token:
            sess = await db.admin_sessions.find_one({"_id": token})
            if sess:
                try:
                    await db.admin_sessions.update_one(
                        {"_id": token},
                        {"$set": {"last_seen": datetime.now(timezone.utc).isoformat()}},
                    )
                except Exception:
                    pass
    except Exception:
        pass

    try:
        while True:
            try:
                poll_interval_seconds = clamp_straddle_poll_seconds(
                    tracker.settings if tracker else None,
                )
                from market_hours import is_market_open as is_market_open_fn
                if not is_market_open_fn(datetime.now(IST)):
                    await websocket.send_json({"status": "market_closed"})
                    await asyncio.sleep(60)
                    continue

                snap = None
                svc = tracker._get_service() if tracker else None
                exp = expiry or (tracker.selected_expiry.get(idx) if tracker else None)
                # Prefer fresh sampler cache — one Kite quote path for all WS clients.
                cached_q = getattr(tracker, "last_straddle_quote", {}).get(idx)
                if (
                    cached_q
                    and _is_recent_straddle_sample(
                        {"timestamp": cached_q.get("ts")},
                        poll_interval_seconds + 2,
                    )
                    and (not expiry or cached_q.get("expiry") == expiry)
                ):
                    await websocket.send_json({
                        "ts": cached_q.get("ts"),
                        "premium": cached_q.get("premium"),
                        "underlying": cached_q.get("underlying"),
                        "atm": cached_q.get("atm"),
                        "ce_ltp": cached_q.get("ce_ltp"),
                        "pe_ltp": cached_q.get("pe_ltp"),
                        "expiry": cached_q.get("expiry"),
                    })
                    await asyncio.sleep(poll_interval_seconds)
                    continue

                if svc and hasattr(svc, "get_atm_straddle_quote"):
                    try:
                        snap = await asyncio.to_thread(svc.get_atm_straddle_quote, idx, exp)
                    except Exception:
                        snap = None
                if (
                    not _is_recent_straddle_sample(snap, _straddle_fallback_max_age_seconds())
                    or (expiry and snap.get("expiry") != expiry)
                ):
                    snap = None
                if not snap:
                    cached = tracker.last_snapshot.get(idx) if tracker else None
                    if (
                        cached
                        and _is_recent_straddle_sample(cached, _straddle_fallback_max_age_seconds())
                        and (not expiry or cached.get("expiry") == expiry)
                    ):
                        snap = cached

                if snap:
                    atm = int(snap.get("atm") or 0)
                    price = float(snap.get("price") or 0.0)
                    if snap.get("ce_ltp") is not None and snap.get("pe_ltp") is not None:
                        ce_p = float(snap.get("ce_ltp") or 0)
                        pe_p = float(snap.get("pe_ltp") or 0)
                    else:
                        strike_obj = None
                        for s in snap.get("strikes", []):
                            if int(s.get("strike")) == atm:
                                strike_obj = s
                                break
                        if not strike_obj and snap.get("strikes"):
                            strikes_list = sorted(
                                [int(s.get("strike")) for s in snap.get("strikes", []) if s.get("strike") is not None]
                            )
                            if strikes_list:
                                closest = min(strikes_list, key=lambda x: abs(x - atm))
                                for s in snap.get("strikes", []):
                                    if int(s.get("strike")) == closest:
                                        strike_obj = s
                                        atm = closest
                                        break
                        ce_p = float(strike_obj.get("ce_ltp", 0) if strike_obj else 0)
                        pe_p = float(strike_obj.get("pe_ltp", 0) if strike_obj else 0)
                    premium = round(ce_p + pe_p, 2)
                    source_timestamp = snap.get("timestamp") or snap.get("ts")
                    payload = {
                        "ts": source_timestamp,
                        "premium": premium,
                        "underlying": round(price, 2),
                        "atm": atm,
                        "ce_ltp": round(ce_p, 2),
                        "pe_ltp": round(pe_p, 2),
                        "expiry": snap.get("expiry"),
                    }
                    try:
                        await _persist_straddle_sample(idx, {
                            **snap,
                            "atm": atm,
                            "price": price,
                            "ce_ltp": ce_p,
                            "pe_ltp": pe_p,
                            "premium": premium,
                        })
                    except Exception:
                        logger.warning("ws_straddle: sample persistence failed for %s", idx, exc_info=True)
                    await websocket.send_json(payload)
                else:
                    await websocket.send_json({"error": "no_snapshot"})
            except BaseException as exc:
                if ws_client_gone(exc):
                    await close_ws_quietly(websocket)
                    return
                if not isinstance(exc, Exception):
                    raise
                try:
                    await websocket.send_json({"error": "temporarily_unavailable"})
                except BaseException as send_exc:
                    if not isinstance(send_exc, Exception) and not ws_client_gone(send_exc):
                        raise
                    await close_ws_quietly(websocket)
                    return
            await asyncio.sleep(poll_interval_seconds)
    except BaseException as exc:
        if ws_client_gone(exc):
            await close_ws_quietly(websocket)
            return
        raise


@api_router.websocket("/ws/spot")
async def ws_spot(websocket: WebSocket):
    """Push index LTP. Snapshot during the OI session; Kite Quote only in pre-market / CAS IEP."""
    await websocket.accept()
    try:
        while True:
            enabled = list((tracker.settings.get("enabled_indices") if tracker else None) or INDICES)
            live_any = any_index_in_session(enabled, configs=INDEX_CONFIG)
            quote_overlay = needs_index_quote_overlay()
            payload = {
                "type": "spot",
                "ts": datetime.now(timezone.utc).isoformat(),
                "tickers": [],
            }
            if quote_overlay:
                pack = await _desk_ticker_payload()
                for t in pack.get("tickers") or []:
                    ltp = t.get("ltp")
                    if ltp is None or float(ltp or 0) == 0:
                        continue
                    row = {
                        "index": t.get("index"),
                        "price": round(float(ltp), 2),
                        "timestamp": t.get("as_of") or pack.get("fetched_at"),
                        "mode": "live" if t.get("source") == "kite" else (t.get("source") or "live"),
                        "prev_close": t.get("prev_close"),
                        "day_open": t.get("day_open"),
                        "change": t.get("change"),
                        "change_pct": t.get("change_pct"),
                    }
                    atm = int(t.get("atm") or 0)
                    if atm > 0:
                        row["atm"] = atm
                    if t.get("indicative_close_price"):
                        row["indicative_close_price"] = t["indicative_close_price"]
                        if t.get("indicative_change") is not None:
                            row["indicative_change"] = t["indicative_change"]
                        if t.get("indicative_change_pct") is not None:
                            row["indicative_change_pct"] = t["indicative_change_pct"]
                    elif t.get("indicative_close_price") == 0:
                        row["indicative_close_price"] = 0
                    if t.get("final_close"):
                        row["final_close"] = t["final_close"]
                    payload["tickers"].append(row)
            else:
                for idx in enabled:
                    snap = tracker.last_snapshot.get(idx) if tracker else None
                    if not snap or not snap.get("price"):
                        continue
                    payload["tickers"].append({
                        "index": idx,
                        "price": round(float(snap.get("price") or 0.0), 2),
                        "atm": int(snap.get("atm") or 0),
                        "timestamp": snap.get("timestamp") or datetime.now(timezone.utc).isoformat(),
                        "mode": "live" if snap.get("mode") == "kite" else (snap.get("mode") or "snapshot"),
                        "prev_close": (round(float(snap.get("prev_close") or 0), 2) or None),
                        "day_open": (round(float(snap.get("day_open") or 0), 2) or None),
                        "change": None,
                        "change_pct": None,
                    })
                    row = payload["tickers"][-1]
                    prev = float(row["prev_close"] or row["day_open"] or 0)
                    if prev and row["price"]:
                        row["change"] = round(row["price"] - prev, 2)
                        row["change_pct"] = round((row["price"] - prev) / prev * 100, 3)
            if payload["tickers"]:
                await websocket.send_json(payload)
            elif not live_any and not quote_overlay:
                await websocket.send_json({"type": "status", "status": "market_closed"})
            await asyncio.sleep(
                cas_iep_interval_seconds() if is_cas_iep_window() else (1 if (live_any or quote_overlay) else 8)
            )
    except BaseException as exc:
        if ws_client_gone(exc):
            await close_ws_quietly(websocket)
            return
        raise


@api_router.get("/alerts")
async def get_alerts(
    request: Request,
    limit: int = Query(50, ge=1, le=100),
    _role: str = Depends(require_desk_user),
):
    """Return alerts for the active board session only.

    Uses session_anchor_date so weekend/holiday views stay on the last session,
    and a new trading day no longer surfaces prior-day alerts.
    Filtered to the current admin alert-focus indices when set.
    """
    if db is None or not hasattr(db, "alerts"):
        return {"alerts": []}

    member_sess = None if await _is_admin_request(request) else await _member_session_from_request(request)
    prefs = None
    cutoff = None
    if member_sess:
        _sess, membership_config, plan = await _member_context(request, "alerts")
        if plan == "normal":
            raise HTTPException(403, "Personalized alerts require Premium or Pro")
        from membership import member_alert_purge_cutoff, normalize_member_preferences
        prefs = normalize_member_preferences(
            member_sess["member"].get("preferences"),
            membership_config.get("preference_defaults"),
        )
        cutoff = member_alert_purge_cutoff()

    docs = []
    try:
        anchor = session_anchor_date()
        start_utc, _ = session_window_utc(anchor)
        query = {"created_at": {"$gte": (cutoff or start_utc).isoformat()}}
        try:
            if tracker:
                tracker._refresh_alert_indices_for_today()
                focus = tracker.settings.get("alert_enabled_indices") or []
                if isinstance(focus, str):
                    focus = [focus]
                elif not isinstance(focus, (list, tuple)):
                    focus = []
                focus = [str(x) for x in focus if x]
                if not focus:
                    # Never treat blank focus as "alert nobody".
                    from market_hours import default_alert_indices_for_today
                    focus = list(default_alert_indices_for_today() or [])
                if focus and not prefs:
                    query["index"] = {"$in": focus}
        except Exception:
            pass

        if prefs:
            query["index"] = {"$in": prefs["alert_indices"]}
        docs = await db.alerts.find(
            query,
            {"_id": 1, "index": 1, "created_at": 1, "price": 1, "atm": 1,
             "direction": 1, "severity": 1, "strikes": 1, "message": 1},
        ).sort("created_at", -1).to_list(length=500 if prefs else limit)
    except Exception:
        logger.warning("alerts query failed; returning empty list", exc_info=True)
        docs = []

    if prefs:
        if db is None:
            raise HTTPException(503, "Alert inbox storage unavailable")
        threshold = float(prefs["oi_change_threshold_pct"])
        filtered = []
        source_ids = [str(doc.get("_id")) for doc in docs if doc.get("_id") is not None]
        shift_events = []
        if prefs["alert_types"].get("oi_shift", True) and prefs["alert_indices"]:
            from membership import member_alert_purge_cutoff
            shift_events = await db.member_alert_events.find(
                {
                    "user_id": member_sess["member_id"],
                    "created_at": {"$gte": (cutoff or member_alert_purge_cutoff()).isoformat()},
                    "index": {"$in": prefs["alert_indices"]},
                },
                {
                    "_id": 0,
                    "alert_id": 1,
                    "type": 1,
                    "index": 1,
                    "created_at": 1,
                    "price": 1,
                    "atm": 1,
                    "direction": 1,
                    "severity": 1,
                    "strikes": 1,
                    "message": 1,
                    "side": 1,
                    "window": 1,
                    "value": 1,
                },
            ).sort("created_at", -1).to_list(length=500)
        source_ids.extend(
            str(event.get("alert_id"))
            for event in shift_events
            if event.get("alert_id")
        )
        seen_ids = set()
        if source_ids:
            seen_docs = await db.member_alerts.find(
                {"user_id": member_sess["member_id"], "source_alert_id": {"$in": source_ids}},
                {"_id": 0, "source_alert_id": 1, "seen": 1},
            ).to_list(length=len(source_ids))
            seen_ids = {
                item["source_alert_id"] for item in seen_docs if item.get("seen") is True
            }
        for doc in docs:
            if not prefs["alert_types"].get("oi_change", True):
                continue
            strikes = doc.get("strikes") or []
            def crosses_threshold(strike):
                if not isinstance(strike, dict):
                    return False
                try:
                    return max(
                        abs(float(strike.get("ce_pct") or 0)),
                        abs(float(strike.get("pe_pct") or 0)),
                    ) >= threshold
                except (TypeError, ValueError):
                    return False
            if strikes and not any(crosses_threshold(strike) for strike in strikes):
                continue
            alert_id = str(doc.pop("_id", ""))
            doc["alert_id"] = alert_id
            if not alert_id:
                continue
            doc["type"] = "oi_change"
            doc["seen"] = alert_id in seen_ids
            if isinstance(doc.get("created_at"), str):
                try:
                    datetime.fromisoformat(doc["created_at"])
                except ValueError:
                    continue
            filtered.append(doc)
        shift_threshold = float(prefs["oi_shift_threshold_contracts"])
        for event in shift_events:
            try:
                value = abs(float(event.get("value")))
                datetime.fromisoformat(event["created_at"])
            except (KeyError, TypeError, ValueError):
                continue
            if value < shift_threshold:
                continue
            alert_id = str(event.get("alert_id") or "")
            if not alert_id:
                continue
            event["type"] = "oi_shift"
            event["seen"] = alert_id in seen_ids
            filtered.append(event)
        filtered.sort(key=lambda item: item.get("created_at") or "", reverse=True)
        docs = filtered[:limit]
    else:
        for doc in docs:
            doc.pop("_id", None)
    return {"alerts": docs}


@api_router.delete("/alerts")
async def clear_alerts(_admin: bool = Depends(require_admin)):
    r = await db.alerts.delete_many({})
    return {"deleted": r.deleted_count}


class ClientErrorIn(BaseModel):
    message: str = ""
    stack: str = ""
    source: str = "ui"
    path: str = ""
    href: str = ""


@api_router.post("/errors")
async def report_client_error(payload: ClientErrorIn, request: Request):
    """Desk UI / boundary crashes. No tokens. Rate-limited."""
    src = str(payload.source or "ui")[:32]
    if src not in ("ui", "ws", "boundary"):
        src = "ui"
    await record_error(
        source=src,
        message=payload.message or "client error",
        traceback_text=payload.stack or "",
        path=(payload.path or payload.href or str(request.url.path))[:300],
        kind="ClientError",
        extra={"href": (payload.href or "")[:200]},
    )
    return {"ok": True}


@api_router.get("/errors")
async def list_error_log(
    _admin: bool = Depends(require_admin),
    limit: int = Query(80, ge=1, le=200),
    source: Optional[str] = None,
    hide_market_intel_news: bool = False,
    hide_sources: Optional[str] = None,
):
    if db is None:
        raise HTTPException(503, "Database unavailable")
    query: Dict[str, Any] = {}
    if source:
        query["source"] = str(source)[:32]
    hidden_sources = [
        item.strip()[:32]
        for item in str(hide_sources or "").split(",")
        if item.strip()
    ]
    if hidden_sources:
        query["source"] = (
            {"$nin": hidden_sources}
            if not source
            else {"$eq": query["source"], "$nin": hidden_sources}
        )
    if hide_market_intel_news:
        # Keep Market Intel application failures visible; hide only individual
        # external-source pulls (free RSS/API providers can be noisy).
        query["$nor"] = [{"source": "market_intel", "path": {"$regex": "^/market-intel/source/"}}]
    docs = await db.error_logs.find(query, {"_id": 0}).sort("ts", -1).to_list(length=limit)
    try:
        sources = sorted(s for s in (await db.error_logs.distinct("source")) if s)
    except Exception:
        sources = sorted({str(d.get("source") or "") for d in docs if d.get("source")})
    from error_log import store_stats
    stats = await store_stats(db)
    return {"count": len(docs), "errors": docs, "sources": sources, **stats}


@api_router.get("/external-api-registry")
async def external_api_registry(_admin: bool = Depends(require_admin)):
    """Admin-only live inventory of outbound providers, routes and safe telemetry."""
    if db is None:
        raise HTTPException(503, "Database unavailable")
    from external_api_registry import build_registry
    return await build_registry(db)


@api_router.get("/errors/unseen-count")
async def error_log_unseen_count(_admin: bool = Depends(require_admin)):
    if db is None:
        raise HTTPException(503, "Database unavailable")
    from error_log import count_unseen
    seen_doc = await db.admin_ui_state.find_one({"_id": ADMIN_USERNAME}, {"last_error_log_seen_at": 1})
    since = (seen_doc or {}).get("last_error_log_seen_at")
    n = await count_unseen(db, since)
    return {"unseen": n, "last_seen_at": since}


@api_router.post("/errors/mark-seen")
async def error_log_mark_seen(_admin: bool = Depends(require_admin)):
    if db is None:
        raise HTTPException(503, "Database unavailable")
    from error_log import mark_seen, count_unseen
    iso = await mark_seen(db, ADMIN_USERNAME)
    n = await count_unseen(db, iso)
    return {"ok": True, "last_seen_at": iso, "unseen": n}


@api_router.post("/errors/flush")
async def error_log_flush(_admin: bool = Depends(require_admin)):
    if db is None:
        raise HTTPException(503, "Database unavailable")
    from error_log import flush_all, store_stats
    deleted = await flush_all(db)
    stats = await store_stats(db)
    return {"ok": True, "deleted": deleted, **stats}


@api_router.post("/errors/purge")
async def error_log_purge(
    days: int = Query(..., ge=1, le=3650),
    _admin: bool = Depends(require_admin),
):
    if db is None:
        raise HTTPException(503, "Database unavailable")
    from error_log import purge_from_oldest, store_stats
    deleted = await purge_from_oldest(db, days)
    stats = await store_stats(db)
    return {"ok": True, "deleted": deleted, "days": days, **stats}


@api_router.get("/config")
async def get_config():
    s = dict(_live_settings())
    if tracker:
        try:
            await tracker.sync_poll_intervals_from_db()
            tracker._refresh_alert_indices_for_today()
            s = dict(tracker.settings)
        except Exception:
            pass
    _sanitize_settings_catalog_values(s)
    poll_interval_seconds = clamp_oi_poll_seconds(s)
    straddle_poll = clamp_straddle_poll_seconds(s)
    positions_poll = clamp_positions_poll_seconds(s)
    open_hm, close_hm = display_hours()
    from universe import without_paused_mcx, set_mcx_desk_available
    if s.get("mcx_desk_on"):
        set_mcx_desk_available(True)
    raw_enabled = list(s.get("enabled_indices") or list(INDEX_CONFIG.keys()))
    enabled = raw_enabled if s.get("mcx_desk_on") else without_paused_mcx(raw_enabled, INDEX_CONFIG)
    def _int_or(key, default):
        v = s.get(key)
        if v is None or v == "":
            return default
        return int(v)
    return {
        "indices": INDEX_CONFIG,
        "poll_interval_seconds": poll_interval_seconds,
        "oi_poll_interval_seconds": poll_interval_seconds,
        "straddle_poll_interval_seconds": straddle_poll,
        "positions_poll_interval_seconds": positions_poll,
        "market_intel_ingest_seconds": int(s.get("market_intel_ingest_seconds") or 60),
        "market_intel_retention_days": _int_or("market_intel_retention_days", 5),
        "market_intel_min_history_days": _int_or("market_intel_min_history_days", 2),
        "market_intel_popup_enabled": s.get("market_intel_popup_enabled", True) is not False,
        "market_intel_popup_dock_until_next": s.get("market_intel_popup_dock_until_next", True) is not False,
        **cas_iep_config(),
        "enabled_indices": enabled,
        "mcx_desk_on": bool(s.get("mcx_desk_on")),
        "straddle_enabled_indices": [i for i in (s.get("straddle_enabled_indices", STRADDLE_INDICES) or []) if i in enabled],
        "alert_enabled_indices": [i for i in (s.get("alert_enabled_indices") or []) if i in enabled] or s.get("alert_enabled_indices"),
        "visible_pages": s.get("visible_pages"),
        "admin_visible_pages": s.get("admin_visible_pages"),
        "sitewalkthrough_enabled": bool(s.get("sitewalkthrough_enabled", True)),
        "market_open_ist": s.get("market_open_ist", open_hm),
        "market_close_ist": s.get("market_close_ist", close_hm),
        "second_session_ist": s.get("second_session_ist", "12:00"),
        "show_strike_range": bool(s.get("show_strike_range", False)),
        "show_market_memory": s.get("show_market_memory", True) is not False,
        "show_writer_defense": bool(s.get("show_writer_defense", True)),
        "show_suggestion": bool(s.get("show_suggestion", True)),
        "show_chart_signals": bool(s.get("show_chart_signals", False)),
        "position_mark_glow_after_close": s.get("position_mark_glow_after_close", True) is not False,
        "position_mark_glow_pct": float(s.get("position_mark_glow_pct") or 1.0),
        "alert_toast_opacity": max(60, min(100, int(s.get("alert_toast_opacity") or 90))),
        "overnight_popup_opacity": max(60, min(100, int(s.get("overnight_popup_opacity") or 92))),
        "market_intel_popup_opacity": max(60, min(100, int(s.get("market_intel_popup_opacity") or 92))),
        "indicative_popup_opacity": max(60, min(100, int(s.get("indicative_popup_opacity") or 92))),
        **resolve_desk_ai(s),
        "gift_kite_symbol": "NSEIX:GIFT NIFTY",
        "universe": catalog_public(),
        "known_indices": without_paused_mcx(list(INDEX_CONFIG.keys()), INDEX_CONFIG),
        "app_version": APP_VERSION,
        "app_version_label": APP_VERSION_LABEL,
    }


# ------------------- Simple Admin Auth + Public Access Toggle -------------------
# Helpers moved to top of file. Endpoints follow.


REMEMBER_ME_TTL_SECONDS = 24 * 3600


def _client_ip(request: Request) -> Optional[str]:
    # Only trust forwarding headers from explicitly configured reverse proxies.
    # Otherwise a caller can spoof X-Forwarded-For to bypass IP controls.
    peer = request.client.host if request.client else None
    if peer and peer in _trusted_proxy_ips:
        xff = (request.headers.get("x-forwarded-for") or "").split(",")[0].strip()
        if xff:
            return xff
    return peer


@api_router.post("/auth/login")
async def auth_login(payload: LoginIn, request: Request):
    if not hmac.compare_digest(payload.username, ADMIN_USERNAME) or \
       not await _verify_admin_password(payload.password):
        raise HTTPException(401, "Invalid credentials")
    token = secrets.token_urlsafe(32)
    ip = _client_ip(request)
    now_utc = datetime.now(timezone.utc)
    ttl_min = 480
    try:
        if tracker and tracker.settings.get("admin_session_ttl_minutes"):
            ttl_min = int(tracker.settings["admin_session_ttl_minutes"])
    except Exception:
        pass
    try:
        await db.admin_sessions.insert_one({
            "_id": token,
            "created_at": now_utc.isoformat(),
            "ip": ip,
            "user_agent": request.headers.get("user-agent", "")[:200],
            "ttl_seconds": max(60, ttl_min * 60),
        })
    except (AutoReconnect, ServerSelectionTimeoutError) as exc:
        logger.error("Admin session creation failed because MongoDB is unavailable: %s", exc)
        raise HTTPException(503, "Database is unavailable. Please retry in a moment.") from exc
    remember_token = None
    if payload.remember_me:
        remember_token = secrets.token_urlsafe(32)
        # One remember device per IP — replace any prior token for this machine.
        try:
            if ip:
                await db.admin_remember_devices.delete_many({"ip": ip})
        except Exception:
            pass
        await db.admin_remember_devices.insert_one({
            "_id": remember_token,
            "ip": ip,
            "created_at": now_utc.isoformat(),
            "expires_at": (now_utc + timedelta(seconds=REMEMBER_ME_TTL_SECONDS)).isoformat(),
            "user_agent": request.headers.get("user-agent", "")[:200],
        })
    # Do NOT auto-close public access on admin login — that silently undid the
    # admin's Public access toggle and made "Continue as guest" fail with
    # "Ask Admin to give access" even when they had just turned it ON.

    market_exp = _session_market_expiry_utc(now_utc)
    return {
        "ok": True, "token": token, "is_admin": True, "username": ADMIN_USERNAME,
        "expires_in_seconds": max(60, ttl_min * 60),
        "session_expires_at": market_exp.isoformat(),
        "remember_token": remember_token,
        "remember_expires_in_seconds": REMEMBER_ME_TTL_SECONDS if remember_token else None,
    }


class RememberLoginIn(BaseModel):
    remember_token: str


@api_router.post("/auth/remember-login")
async def auth_remember_login(payload: RememberLoginIn, request: Request):
    """Auto-login from a 24h IP-bound remember token (Remember me)."""
    tok = (payload.remember_token or "").strip()
    if not tok:
        raise HTTPException(401, "Missing remember token")
    if db is None:
        raise HTTPException(503, "Database is unavailable. Please retry in a moment.")
    try:
        doc = await db.admin_remember_devices.find_one({"_id": tok})
    except (AutoReconnect, ServerSelectionTimeoutError) as exc:
        logger.error("Remember-token lookup failed because MongoDB is unavailable: %s", exc)
        raise HTTPException(503, "Database is unavailable. Please retry in a moment.") from exc
    if not doc:
        raise HTTPException(401, "Remember token invalid")
    try:
        exp = datetime.fromisoformat(doc["expires_at"])
    except Exception:
        raise HTTPException(401, "Remember token invalid")
    if datetime.now(timezone.utc) >= exp:
        try:
            await db.admin_remember_devices.delete_one({"_id": tok})
        except Exception:
            pass
        raise HTTPException(401, "Remember token expired")
    ip = _client_ip(request)
    if doc.get("ip") and ip and doc["ip"] != ip:
        # Soft-fail: keep the remember token (IP can change on mobile/CGNAT).
        # Only reject this attempt — do not delete the device record.
        ua = (request.headers.get("user-agent") or "")[:200]
        stored_ua = (doc.get("user_agent") or "")[:200]
        if not stored_ua or stored_ua != ua:
            raise HTTPException(401, "Remember token not valid for this device/IP")
        # UA matches → allow (IP drifted but same browser profile)
        logger.info("remember-login: IP changed (%s → %s) but UA matched — allowing", doc.get("ip"), ip)
    # Issue a fresh session (same as login)
    session_tok = secrets.token_urlsafe(32)
    now_utc = datetime.now(timezone.utc)
    ttl_min = int((tracker.settings or {}).get("admin_session_ttl_minutes", 480) if tracker else 480)
    try:
        await db.admin_sessions.insert_one({
            "_id": session_tok,
            "created_at": now_utc.isoformat(),
            "ip": ip,
            "user_agent": request.headers.get("user-agent", "")[:200],
            "ttl_seconds": max(60, ttl_min * 60),
            "from_remember": True,
        })
    except (AutoReconnect, ServerSelectionTimeoutError) as exc:
        logger.error("Remember-session creation failed because MongoDB is unavailable: %s", exc)
        raise HTTPException(503, "Database is unavailable. Please retry in a moment.") from exc
    market_exp = _session_market_expiry_utc(now_utc)
    return {
        "ok": True, "token": session_tok, "is_admin": True, "username": ADMIN_USERNAME,
        "expires_in_seconds": max(60, ttl_min * 60),
        "session_expires_at": market_exp.isoformat(),
    }


class ChangePasswordIn(BaseModel):
    old_password: str
    new_password: str


@api_router.post("/auth/change-password")
async def auth_change_password(payload: ChangePasswordIn, request: Request,
                               _admin: bool = Depends(require_admin)):
    if not await _verify_admin_password(payload.old_password):
        raise HTTPException(401, "Current password is incorrect")
    new_pw = (payload.new_password or "")
    if len(new_pw) < 8:
        raise HTTPException(400, "New password must be at least 8 characters")
    if new_pw == payload.old_password:
        raise HTTPException(400, "New password must differ from current password")
    await _store_admin_password(new_pw)
    # Invalidate ALL admin sessions except the caller so any other logged-in device is signed out.
    tok = _extract_bearer(request, "x-admin-token")
    try:
        if tok:
            await db.admin_sessions.delete_many({"_id": {"$ne": tok}})
        else:
            await db.admin_sessions.delete_many({})
    except Exception:
        pass
    return {"ok": True, "message": "Password changed. Other devices have been signed out."}


@api_router.post("/auth/logout")
async def auth_logout(request: Request):
    tok = _extract_bearer(request, "x-admin-token")
    if tok:
        await db.admin_sessions.delete_one({"_id": tok})
    member_token = (
        _extract_bearer(request, "x-member-token")
        or _extract_bearer(request, "x-guest-token")
    )
    if member_token and db is not None:
        await db.member_sessions.update_one(
            {"_id": {"$in": [_member_session_storage_id(member_token), member_token]},
             "revoked_at": {"$exists": False}},
            {"$set": {
                "revoked_at": datetime.now(timezone.utc),
                "revoked_reason": "logout",
            }},
        )
    # Also clear remember-me for this IP if present
    ip = _client_ip(request)
    if ip:
        try:
            await db.admin_remember_devices.delete_many({"ip": ip})
        except Exception:
            pass
    return {"ok": True}


class GuestSessionIn(BaseModel):
    name: str


@api_router.post("/auth/guest")
async def auth_guest_start(payload: GuestSessionIn, request: Request):
    """Guest access entry.

    • New IP/name → pending until admin approves (default), or immediate session
      when admin turns off Require approval.
    • Returning guests must present their existing bearer token or submit a new
      request; an IP address and display name do not prove guest identity.
    • Blocked IP → soft refusal message.
    """
    if await _get_maintenance_state():
        raise HTTPException(503, "Desk is preparing for a short update. Please try again soon.")
    if not await _get_guest_login_enabled():
        raise HTTPException(403, "Guest sign-in is disabled. Please sign in with Google.")
    open_, _ = await _get_public_access_state()
    if not open_:
        raise HTTPException(403, "Public access is not open. Please ask the admin to give access.")
    name = (payload.name or "").strip()
    if len(name) < 2 or len(name) > 100:
        raise HTTPException(400, "Please enter your full name (2–100 chars).")
    if " " not in name:
        raise HTTPException(400, "Please enter your FULL name (first name + last name).")
    ip = _client_ip(request)
    if await _is_ip_blocked(ip):
        raise HTTPException(403, BLOCKED_IP_MESSAGE)
    ua = request.headers.get("user-agent", "")[:200]
    now_iso = datetime.now(timezone.utc).isoformat()
    open_door = not await _get_guest_require_approval()

    if open_door:
        return await _admit_guest_immediate(name, ip, ua, reason="open_door")

    # The IP binds approval-status polling but never serves as proof of identity.
    req_id = secrets.token_urlsafe(16)
    await db.access_requests.insert_one({
        "_id": req_id,
        "name": name,
        "ip": ip,
        "user_agent": ua,
        "status": "pending",
        "created_at": now_iso,
        "updated_at": now_iso,
    })
    logger.info(f"ACCESS REQUEST pending: name='{name}' ip={ip} id={req_id}")
    try:
        import notifier as _n
        await _n.send_message(
            f"🛂 <b>Access request</b>\n{name}\nIP: <code>{ip or '—'}</code>",
            dedupe_key=f"access_req:{req_id}",
            cooldown_seconds=0,
        )
    except Exception:
        pass
    return {
        "ok": True,
        "status": "pending",
        "request_id": req_id,
        "name": name,
        "message": "Waiting for admin approval",
    }


@api_router.get("/auth/access-request/{request_id}")
async def auth_access_request_status(request_id: str, request: Request):
    """Guest polls this while waiting for admin approve/reject."""
    if not await _get_guest_login_enabled():
        raise HTTPException(403, "Guest sign-in is disabled. Please sign in with Google.")
    doc = await db.access_requests.find_one({"_id": request_id})
    if not doc:
        raise HTTPException(404, "Request not found")
    # Bind poll to originating IP when known (stops token fishing).
    ip = _client_ip(request)
    if doc.get("ip") and ip and doc["ip"] != ip:
        raise HTTPException(403, "Request not valid for this device")
    out = {
        "request_id": doc["_id"],
        "status": doc.get("status"),
        "name": doc.get("name"),
        "created_at": doc.get("created_at"),
        "decided_at": doc.get("decided_at"),
    }
    if doc.get("status") == "approved" and doc.get("guest_token"):
        out["token"] = doc["guest_token"]
        out["expires_in_seconds"] = _guest_seconds_remaining(_next_6am_ist_utc())
        out["expires_at"] = _next_6am_ist_utc().isoformat()
        # Prefer the minted session's stored expiry when available.
        try:
            sess = await db.guest_sessions.find_one({"_id": doc["guest_token"]})
            if sess and sess.get("expires_at"):
                exp = datetime.fromisoformat(sess["expires_at"])
                if exp.tzinfo is None:
                    exp = exp.replace(tzinfo=timezone.utc)
                out["expires_at"] = exp.isoformat()
                out["expires_in_seconds"] = _guest_seconds_remaining(exp)
        except Exception:
            pass
        out["status"] = "approved"
        # Hand off once — subsequent polls see "consumed" so the token isn't
        # endlessly re-exposed. Client must persist the token on first receipt.
        try:
            await db.access_requests.update_one(
                {"_id": request_id, "status": "approved"},
                {"$set": {
                    "status": "consumed",
                    "consumed_at": datetime.now(timezone.utc).isoformat(),
                }},
            )
        except Exception:
            pass
    elif doc.get("status") == "consumed":
        # Token already handed off — tell client to use stored session / re-enter name.
        out["status"] = "consumed"
    return out


@api_router.post("/auth/guest/logout")
async def auth_guest_logout(request: Request):
    """Guest Exit — revoke this guest session."""
    tok = _extract_bearer(request, "x-guest-token")
    now_iso = datetime.now(timezone.utc).isoformat()
    if tok:
        try:
            await db.guest_sessions.update_one(
                {"_id": tok, "revoked_at": {"$exists": False}},
                {"$set": {"revoked_at": now_iso, "revoked_reason": "guest_logout"}},
            )
        except Exception:
            pass
        try:
            await db.member_sessions.update_one(
                {"_id": {"$in": [_member_session_storage_id(tok), tok]},
                 "revoked_at": {"$exists": False}},
                {"$set": {
                    "revoked_at": datetime.now(timezone.utc),
                    "revoked_reason": "logout",
                }},
            )
        except Exception:
            pass
    return {"ok": True}


@api_router.get("/auth/state")
async def auth_state(request: Request):
    """Public endpoint — returns app-access state for the caller."""
    if db is None:
        return {
            "requires_login": False,
            "public_access_open": True,
            "public_landing_enabled": False,
            "sitewalkthrough_enabled": bool(_live_settings().get("sitewalkthrough_enabled", True)),
            "maintenance_mode": False,
            "public_access_expires_at": None,
            "is_admin": _is_local_dev_admin_bypass_request(request),
            "is_guest": False,
            "is_member": False,
            "google_login_enabled": False,
            "guest_login_enabled": False,
            "local_dev_member_login_enabled": bool(
                LOCAL_DEV_MEMBER_USERS and _is_local_dev_request(request)
            ),
            "local_dev_member_accounts": (
                _local_dev_member_account_emails()
                if _is_local_dev_request(request)
                else []
            ),
            "membership_signup_enabled": False,
            "guest_name": None,
            "needs_guest_name": False,
            "auth_unavailable": True,
            "suggested_guest_name": None,
            "auto_guest_token": None,
            "is_ip_blocked": False,
            "local_dev_admin_bypass": _is_local_dev_admin_bypass_request(request),
        }
    open_, expires_at_iso = await _get_public_access_state()
    platform_doc = await _load_platform_config()
    public_landing_enabled = bool((platform_doc or {}).get("public_landing_enabled", False))
    google_settings = (platform_doc or {}).get("google") or {}
    google_login_enabled = bool(
        google_settings.get("enabled")
        and google_settings.get("client_id_enc")
        and google_settings.get("client_secret_enc")
    )
    guest_login_enabled = (platform_doc or {}).get("guest_login_enabled") is True
    member_config = _platform_membership(platform_doc)
    maintenance_mode = await _get_maintenance_state()
    sitewalkthrough_enabled = await _get_sitewalkthrough_enabled()
    if maintenance_mode:
        sitewalkthrough_enabled = False
    admin_sess = await _admin_from_request(request)
    is_admin = admin_sess is not None
    guest_sess = None if is_admin else (await _guest_from_request(request))
    is_guest = guest_sess is not None
    admin_name = ADMIN_USERNAME if is_admin else None
    guest_name = guest_sess.get("name") if is_guest else None
    needs_guest_name = open_ and guest_login_enabled and not is_admin and not is_guest
    is_member = bool(guest_sess and guest_sess.get("is_member"))
    requires_login = (not open_) and (not is_admin) and not is_member
    admin_session_expires_at = None
    if is_admin and admin_sess:
        try:
            created = datetime.fromisoformat(admin_sess["created_at"])
            expire_on_close = False
            if tracker and "expire_admin_on_market_close" in tracker.settings:
                expire_on_close = bool(tracker.settings["expire_admin_on_market_close"])
            if expire_on_close:
                admin_session_expires_at = _session_market_expiry_utc(created).isoformat()
        except Exception:
            admin_session_expires_at = None
    # IP-based names are not identity proof and must not be disclosed here.
    suggested_guest_name = None
    auto_guest_token = None
    auto_guest_name = None
    auto_guest_expires_in = None
    auto_guest_expires_at = None
    guest_expires_at = None
    if is_guest and guest_sess and not is_member:
        guest_expires_at = guest_sess.get("expires_at")
        if not guest_expires_at:
            try:
                started = datetime.fromisoformat(guest_sess.get("started_at"))
                guest_expires_at = _guest_expiry_from_start(started).isoformat()
            except Exception:
                guest_expires_at = _next_6am_ist_utc().isoformat()
    member_summary = None
    if is_member and guest_sess:
        plan = _effective_member_plan(guest_sess.get("member") or {})
        from membership import normalize_member_preferences, plan_features
        member_record = guest_sess.get("member") or {}
        feature_config = member_config
        if member_record.get("local_dev_test_account") and _is_local_dev_request(request):
            # Keep auth-state entitlements consistent with local-only member API gates.
            feature_config = {**member_config, "experience_enabled": True}
        plan_config = feature_config["plans"].get(plan)
        subscription = member_record.get("subscription") or {}
        paid_plans_ready = bool(
            feature_config["experience_enabled"]
            and feature_config["paid_subscriptions_enabled"]
            and _billing_readiness(platform_doc or {}, feature_config)["ready"]
        )
        member_summary = {
            "plan": plan,
            "enabled": bool(
                feature_config["experience_enabled"]
                and plan_config
                and plan_config["enabled"]
            ),
            "available_paid_plans": [
                plan_id
                for plan_id in ("premium", "pro")
                if paid_plans_ready and feature_config["plans"][plan_id]["enabled"]
            ],
            "features": sorted(plan_features(feature_config, plan)),
            "email": member_record.get("email"),
            "subscription": {
                "status": subscription.get("status"),
                "current_end": subscription.get("current_end"),
            },
            "preferences": normalize_member_preferences(
                member_record.get("preferences"),
                member_config.get("preference_defaults"),
            ),
        }
    ip = _client_ip(request)
    pending_access_count = 0
    if is_admin:
        pending_access_count = await _pending_access_count()
    return {
        "requires_login": requires_login,
        "public_access_open": open_,
        "public_landing_enabled": public_landing_enabled,
        "sitewalkthrough_enabled": sitewalkthrough_enabled,
        "maintenance_mode": maintenance_mode,
        "public_access_expires_at": expires_at_iso,
        "is_admin": is_admin,
        "local_dev_admin_bypass": _is_local_dev_admin_bypass_request(request),
        "is_guest": is_guest,
        "is_member": is_member,
        "membership": member_summary,
        "google_login_enabled": google_login_enabled,
        "guest_login_enabled": guest_login_enabled,
        "local_dev_member_login_enabled": bool(
            LOCAL_DEV_MEMBER_USERS and _is_local_dev_request(request)
        ),
        "local_dev_member_accounts": (
            _local_dev_member_account_emails()
            if _is_local_dev_request(request)
            else []
        ),
        "membership_signup_enabled": bool(
            member_config["experience_enabled"] and member_config["signup_enabled"]
        ),
        "guest_name": guest_name,
        "needs_guest_name": needs_guest_name,
        "suggested_guest_name": suggested_guest_name,
        "auto_guest_token": auto_guest_token,
        "auto_guest_name": auto_guest_name,
        "auto_guest_expires_in": auto_guest_expires_in,
        "auto_guest_expires_at": auto_guest_expires_at,
        "guest_expires_at": guest_expires_at,
        "admin_name": admin_name,
        "admin_display_name": ADMIN_USERNAME,
        "session_ttl_seconds": (
            int(tracker.settings.get("admin_session_ttl_minutes", 480)) * 60
            if tracker else ADMIN_SESSION_TTL_SECONDS
        ),
        "admin_session_expires_at": admin_session_expires_at,
        "expire_admin_on_market_close": bool(
            (tracker.settings or {}).get("expire_admin_on_market_close", False) if tracker else False
        ),
        "can_remember_login": True,
        "pending_access_count": pending_access_count,
        "guest_require_approval": await _get_guest_require_approval(),
        "ip_blocked": await _is_ip_blocked(ip) if not is_admin else False,
        "user_kite": await _auth_user_kite_payload(is_admin, guest_sess),
    }


class PublicAccessIn(BaseModel):
    open: Optional[bool] = None
    require_approval: Optional[bool] = None


class MaintenanceModeIn(BaseModel):
    enabled: bool


class PublicLandingIn(BaseModel):
    enabled: bool


@api_router.post("/auth/public-landing", dependencies=[])
async def auth_toggle_public_landing(payload: PublicLandingIn, request: Request):
    if not await _is_admin_request(request):
        raise HTTPException(401, "Admin only")
    if db is None:
        raise HTTPException(503, "Service unavailable")
    await db.settings.update_one(
        {"_id": PLATFORM_CONFIG_ID},
        {"$set": {"public_landing_enabled": bool(payload.enabled)}},
        upsert=True,
    )
    return {"ok": True, "public_landing_enabled": bool(payload.enabled)}


@api_router.post("/auth/maintenance", dependencies=[])
async def auth_toggle_maintenance(payload: MaintenanceModeIn, request: Request):
    """Admin-only public maintenance switch; admin sessions remain valid."""
    if not await _is_admin_request(request):
        raise HTTPException(401, "Admin only")
    if db is None:
        raise HTTPException(503, "Service unavailable")
    try:
        # Force the preview off on either transition, including sites already under
        # maintenance before this setting was introduced; admins can re-enable it afterward.
        await db.settings.update_one(
            {"_id": "alerts"},
            {"$set": {"sitewalkthrough_enabled": False}},
            upsert=True,
        )
        if tracker and isinstance(getattr(tracker, "settings", None), dict):
            tracker.settings["sitewalkthrough_enabled"] = False
        await db.settings.update_one(
            {"_id": "maintenance_mode"},
            {
                "$set": {
                    "enabled": bool(payload.enabled),
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                    "updated_by": ADMIN_USERNAME,
                }
            },
            upsert=True,
        )
    except Exception:
        raise HTTPException(503, "Service unavailable")
    sitewalkthrough_enabled = await _get_sitewalkthrough_enabled()
    if payload.enabled:
        sitewalkthrough_enabled = False
    return {
        "ok": True,
        "maintenance_mode": bool(payload.enabled),
        "sitewalkthrough_enabled": sitewalkthrough_enabled,
    }


@api_router.post("/auth/public-access", dependencies=[])
async def auth_toggle_public(payload: PublicAccessIn, request: Request):
    if not await _is_admin_request(request):
        raise HTTPException(401, "Admin only")
    if payload.open is None and payload.require_approval is None:
        raise HTTPException(400, "Provide open and/or require_approval")
    if payload.require_approval is not None:
        await db.settings.update_one(
            {"_id": "public_access"},
            {"$set": {"require_approval": bool(payload.require_approval)}},
            upsert=True,
        )
    open_now, expires_at_iso = await _get_public_access_state()
    if payload.open is True:
        expires_utc = _next_market_close_ist()
        await db.settings.update_one(
            {"_id": "public_access"},
            {"$set": {"open": True, "expires_at": expires_utc.isoformat()}},
            upsert=True,
        )
        require_approval = await _get_guest_require_approval()
        return {
            "ok": True,
            "open": True,
            "expires_at": expires_utc.isoformat(),
            "require_approval": require_approval,
        }
    if payload.open is False:
        await db.settings.update_one(
            {"_id": "public_access"},
            {"$set": {"open": False, "expires_at": None}},
            upsert=True,
        )
        # Revoke all guest sessions so nobody remains authenticated after close,
        # but keep login records for later auditing.
        await _revoke_guest_sessions("public_access_closed")
        # Auto-reject lingering pending requests.
        try:
            now_iso = datetime.now(timezone.utc).isoformat()
            await db.access_requests.update_many(
                {"status": "pending"},
                {"$set": {"status": "rejected", "decided_at": now_iso, "decided_reason": "public_access_closed"}},
            )
        except Exception:
            pass
        require_approval = await _get_guest_require_approval()
        return {"ok": True, "open": False, "expires_at": None, "require_approval": require_approval}
    require_approval = await _get_guest_require_approval()
    return {
        "ok": True,
        "open": open_now,
        "expires_at": expires_at_iso,
        "require_approval": require_approval,
    }


@api_router.get("/auth/guests")
async def auth_list_guests(request: Request, since_hours: int = Query(24, ge=1, le=168),
                           _admin: bool = Depends(require_admin)):
    """Admin-only: list guests active in the last N hours (default 24h)."""
    since_dt = datetime.now(timezone.utc) - timedelta(hours=since_hours)
    docs = await db.guest_sessions.find(
        {"started_at": {"$gte": since_dt.isoformat()}},
    ).sort("started_at", -1).to_list(length=500)
    now = datetime.now(timezone.utc)
    out = []
    for d in docs:
        row = {
            "token": d.get("_id"),
            "name": d.get("name"),
            "ip": d.get("ip"),
            "user_agent": d.get("user_agent"),
            "started_at": d.get("started_at"),
            "last_seen_at": d.get("last_seen_at"),
            "revoked_at": d.get("revoked_at"),
            "revoked_reason": d.get("revoked_reason"),
        }
        try:
            ls = datetime.fromisoformat(d.get("last_seen_at") or d.get("started_at"))
            row["active"] = not bool(d.get("revoked_at")) and (now - ls).total_seconds() < 300
            row["idle_seconds"] = int((now - ls).total_seconds())
        except Exception:
            row["active"] = False
            row["idle_seconds"] = None
        out.append(row)
    return {"guests": out, "count": len(out), "since_hours": since_hours}


@api_router.post("/auth/guests/{token}/revoke")
async def auth_revoke_guest(token: str, _admin: bool = Depends(require_admin)):
    """Kick a single guest session immediately."""
    tok = (token or "").strip()
    if not tok:
        raise HTTPException(400, "Missing guest token")
    now_iso = datetime.now(timezone.utc).isoformat()
    existing = await db.guest_sessions.find_one({"_id": tok})
    if not existing:
        raise HTTPException(404, "Guest session not found")
    await db.guest_sessions.update_one(
        {"_id": tok, "revoked_at": {"$exists": False}},
        {"$set": {"revoked_at": now_iso, "revoked_reason": "admin_kick"}},
    )
    return {"ok": True, "token": tok, "revoked": True}


@api_router.get("/auth/access-requests")
async def auth_list_access_requests(
    status: Optional[str] = Query(None),
    _admin: bool = Depends(require_admin),
):
    """Admin queue: pending (default) + recent decided requests."""
    q = {}
    if status in ("pending", "approved", "rejected", "consumed"):
        q["status"] = status
    else:
        # Default: pending first, plus recent decisions (last 24h)
        since = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()
        q = {"$or": [
            {"status": "pending"},
            {"decided_at": {"$gte": since}},
            {"created_at": {"$gte": since}},
        ]}
    docs = await db.access_requests.find(q).sort("created_at", -1).to_list(length=200)
    rows = []
    for d in docs:
        rows.append({
            "request_id": d.get("_id"),
            "name": d.get("name"),
            "ip": d.get("ip"),
            "status": d.get("status"),
            "created_at": d.get("created_at"),
            "decided_at": d.get("decided_at"),
            "decided_reason": d.get("decided_reason"),
        })
    pending = sum(1 for r in rows if r["status"] == "pending")
    return {"requests": rows, "pending_count": pending}


@api_router.post("/auth/access-requests/{request_id}/approve")
async def auth_approve_access(request_id: str, request: Request, _admin: bool = Depends(require_admin)):
    open_, _ = await _get_public_access_state()
    if not open_:
        raise HTTPException(400, "Turn Public Access ON before approving guests.")
    doc = await db.access_requests.find_one({"_id": request_id})
    if not doc:
        raise HTTPException(404, "Request not found")
    if doc.get("status") not in ("pending",):
        raise HTTPException(400, f"Request is already {doc.get('status')}")
    if doc.get("ip") and await _is_ip_blocked(doc["ip"]):
        raise HTTPException(400, "This IP is blocked. Unblock it first.")
    ua = doc.get("user_agent") or ""
    guest = await _create_guest_session(doc["name"], doc.get("ip"), ua, request_id=request_id)
    now_iso = datetime.now(timezone.utc).isoformat()
    await db.access_requests.update_one(
        {"_id": request_id},
        {"$set": {
            "status": "approved",
            "decided_at": now_iso,
            "decided_reason": "admin_approve",
            "guest_token": guest["token"],
        }},
    )
    logger.info(f"ACCESS APPROVED: name='{doc['name']}' ip={doc.get('ip')} id={request_id}")
    return {"ok": True, "request_id": request_id, "status": "approved", "guest_name": doc["name"]}


@api_router.post("/auth/access-requests/{request_id}/reject")
async def auth_reject_access(request_id: str, _admin: bool = Depends(require_admin)):
    doc = await db.access_requests.find_one({"_id": request_id})
    if not doc:
        raise HTTPException(404, "Request not found")
    if doc.get("status") != "pending":
        raise HTTPException(400, f"Request is already {doc.get('status')}")
    now_iso = datetime.now(timezone.utc).isoformat()
    await db.access_requests.update_one(
        {"_id": request_id},
        {"$set": {"status": "rejected", "decided_at": now_iso, "decided_reason": "admin_reject"}},
    )
    return {"ok": True, "request_id": request_id, "status": "rejected"}


class BlockIpIn(BaseModel):
    ip: str
    reason: Optional[str] = None


@api_router.get("/auth/blocked-ips")
async def auth_list_blocked_ips(_admin: bool = Depends(require_admin)):
    docs = await db.blocked_ips.find({}).sort("blocked_at", -1).to_list(length=200)
    rows = [{
        "ip": d.get("_id"),
        "reason": d.get("reason"),
        "blocked_at": d.get("blocked_at"),
        "name_hint": d.get("name_hint"),
    } for d in docs]
    return {"blocked": rows, "count": len(rows)}


@api_router.post("/auth/blocked-ips")
async def auth_block_ip(payload: BlockIpIn, _admin: bool = Depends(require_admin)):
    ip = (payload.ip or "").strip()
    if not ip or len(ip) > 64:
        raise HTTPException(400, "Invalid IP")
    now_iso = datetime.now(timezone.utc).isoformat()
    name_hint = None
    try:
        g = await db.guest_sessions.find_one({"ip": ip}, sort=[("started_at", -1)])
        if g:
            name_hint = g.get("name")
    except Exception:
        pass
    await db.blocked_ips.update_one(
        {"_id": ip},
        {"$set": {
            "reason": (payload.reason or "admin_block")[:200],
            "blocked_at": now_iso,
            "name_hint": name_hint,
        }},
        upsert=True,
    )
    kicked = await _revoke_guests_for_ip(ip, "ip_blocked")
    # Reject pending requests from this IP
    try:
        await db.access_requests.update_many(
            {"ip": ip, "status": "pending"},
            {"$set": {"status": "rejected", "decided_at": now_iso, "decided_reason": "ip_blocked"}},
        )
    except Exception:
        pass
    return {"ok": True, "ip": ip, "sessions_revoked": kicked}


@api_router.delete("/auth/blocked-ips/{ip}")
async def auth_unblock_ip(ip: str, _admin: bool = Depends(require_admin)):
    ip = (ip or "").strip()
    if not ip:
        raise HTTPException(400, "Invalid IP")
    await db.blocked_ips.delete_one({"_id": ip})
    return {"ok": True, "ip": ip, "unblocked": True}


# ------------------- Telegram notifications -------------------
import notifier as _notifier
from market_hours import market_status as _market_status


@api_router.get("/telegram/status")
async def telegram_status():
    await _notifier.get_prefs()
    token_ok, chat_ok = _notifier._cfg()
    return {
        "configured": _notifier.is_configured(),
        "bot_token_configured": bool(token_ok),
        "chat_id_configured": bool(chat_ok),
    }


@api_router.get("/telegram/prefs")
async def telegram_prefs_get(_admin: bool = Depends(require_admin)):
    return await _notifier.get_prefs()


class TelegramPrefsIn(BaseModel):
    enabled: Optional[bool] = None
    indices: Optional[dict] = None
    types: Optional[dict] = None
    quiet_hours: Optional[dict] = None
    major_abs_threshold: Optional[float] = None
    bot_token: Optional[str] = None
    chat_id: Optional[str] = None


@api_router.post("/telegram/prefs")
async def telegram_prefs_set(payload: TelegramPrefsIn, _admin: bool = Depends(require_admin)):
    return await _notifier.save_prefs(payload.model_dump(exclude_none=True))


# Quick-preset endpoints (POST for idempotence + rate-limit friendliness)
_PRESETS = {
    "everything": {
        "enabled": True,
        "indices": {"NIFTY": True, "SENSEX": True, "BANKNIFTY": True},
        "types": {"oi_reversal": True, "huge_shift": True, "huge_shift_major_only": False,
                  "market_open": True, "market_close": True, "daily_digest": True,
                  "tracker_errors": True, "kite_token": True},
        "quiet_hours": {"enabled": False, "start": "09:00", "end": "10:30"},
    },
    "nifty_only": {
        "enabled": True,
        "indices": {"NIFTY": True, "SENSEX": False, "BANKNIFTY": False},
    },
    "sensex_only": {
        "enabled": True,
        "indices": {"NIFTY": False, "SENSEX": True, "BANKNIFTY": False},
    },
    "banknifty_only": {
        "enabled": True,
        "indices": {"NIFTY": False, "SENSEX": False, "BANKNIFTY": True},
    },
    "morning_only": {
        "enabled": True,
        "quiet_hours": {"enabled": True, "start": "09:00", "end": "10:30"},
    },
    "digest_only": {
        "enabled": True,
        "types": {"oi_reversal": False, "huge_shift": False, "market_open": False,
                  "market_close": True, "daily_digest": True, "tracker_errors": True,
                  "kite_token": True, "huge_shift_major_only": True},
    },
    "major_shifts_only": {
        "enabled": True,
        "types": {"oi_reversal": False, "huge_shift": True, "huge_shift_major_only": True,
                  "market_open": False, "market_close": False, "daily_digest": True,
                  "tracker_errors": True, "kite_token": True},
    },
    "off": {"enabled": False},
}


@api_router.post("/telegram/prefs/preset/{name}")
async def telegram_prefs_preset(name: str, _admin: bool = Depends(require_admin)):
    preset = _PRESETS.get(name)
    if not preset:
        raise HTTPException(400, f"Unknown preset '{name}'. Available: {list(_PRESETS.keys())}")
    return await _notifier.save_prefs(preset)


@api_router.post("/telegram/test")
async def telegram_test(_admin: bool = Depends(require_admin)):
    await _notifier.get_prefs()
    if not _notifier.is_configured():
        raise HTTPException(400, "Telegram not configured. Set bot token and chat ID in Admin → Admin configuration.")
    ok = await _notifier.send_test_message()
    if not ok:
        raise HTTPException(502, "Telegram send failed — check bot token / chat id / network.")
    return {"ok": True, "sent": True}


class HugeShiftContribution(BaseModel):
    model_config = ConfigDict(extra="forbid")

    strike: float = Field(allow_inf_nan=False)
    ce_delta: float = Field(default=0, allow_inf_nan=False)
    pe_delta: float = Field(default=0, allow_inf_nan=False)


class HugeShiftIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    index: Literal["NIFTY", "BANKNIFTY", "SENSEX"]
    side: Literal["CE", "PE"]
    value: float = Field(allow_inf_nan=False)
    direction: Literal["build", "unwind"]
    window: Literal[1, 3, 5]
    price: Optional[float] = Field(default=None, allow_inf_nan=False)
    atm: Optional[float] = Field(default=None, allow_inf_nan=False)
    contributing: List[HugeShiftContribution] = Field(default_factory=list, max_length=5)


@api_router.post("/telegram/huge-shift")
async def telegram_huge_shift(
    payload: HugeShiftIn,
    _admin: bool = Depends(require_admin),
):
    await _notifier.get_prefs()
    if not _notifier.is_configured():
        return {"ok": False, "reason": "telegram_not_configured"}
    # Respect admin Alert Settings index focus (same gate as OI reversal alerts).
    try:
        if tracker:
            tracker._refresh_alert_indices_for_today()
            focus = tracker.settings.get("alert_enabled_indices") or []
            if payload.index not in focus:
                return {"ok": False, "reason": "index_not_in_alert_focus"}
    except Exception as e:
        # Fail closed — never send Telegram for an unverified focus check.
        logging.getLogger(__name__).warning("telegram_huge_shift focus check failed: %s", e)
        return {"ok": False, "reason": "alert_focus_check_failed"}
    try:
        await _notifier.alert_huge_shift(payload.model_dump())
    except Exception as e:
        raise HTTPException(502, f"Telegram send failed: {e}")
    return {"ok": True}


@api_router.post("/telegram/digest/preview")
async def telegram_digest_preview(_admin: bool = Depends(require_admin)):
    """Build (but do NOT send) today's digest — for UI preview / testing."""
    return await tracker.build_daily_digest()


@api_router.post("/telegram/digest/send")
async def telegram_digest_send(_admin: bool = Depends(require_admin)):
    """Manually send today's digest to Telegram now (useful for testing or if auto-send missed)."""
    await _notifier.get_prefs()
    if not _notifier.is_configured():
        raise HTTPException(400, "Telegram not configured.")
    digest = await tracker.build_daily_digest()
    ok = await _notifier.send_daily_digest(digest)
    return {"ok": True, "sent": ok, "digest": digest}


@api_router.get("/market/status")
async def market_status_endpoint():
    return _market_status()


# ------------------- Sidebar admin note (public GET, admin POST/DELETE) -------------------
class SidebarNoteIn(BaseModel):
    text: Optional[str] = None


@api_router.get("/sidebar/note")
async def get_sidebar_note():
    """Public: return the stored sidebar note (text + updated_at)."""
    try:
        doc = await db.settings.find_one({"_id": "sidebar_note"}, {"_id": 0})
        if not doc:
            return {"text": "", "updated_at": None}
        return doc
    except Exception:
        return {"text": "", "updated_at": None}


@api_router.post("/sidebar/note")
async def save_sidebar_note(payload: SidebarNoteIn, _admin: bool = Depends(require_admin)):
    """Admin: save or update the sidebar note."""
    text = (payload.text or "").strip()
    now_iso = datetime.now(timezone.utc).isoformat()
    await db.settings.update_one({"_id": "sidebar_note"}, {"$set": {"text": text, "updated_at": now_iso}}, upsert=True)
    doc = await db.settings.find_one({"_id": "sidebar_note"}, {"_id": 0})
    return {"ok": True, "note": doc}


@api_router.delete("/sidebar/note")
async def delete_sidebar_note(_admin: bool = Depends(require_admin)):
    """Admin: delete the stored sidebar note."""
    await db.settings.delete_one({"_id": "sidebar_note"})
    return {"ok": True}


# ------------------- Multi-index quote for header ticker -------------------
async def _desk_ticker_payload():
    """LTP + prev close for every enabled desk index.

    Kite quote when connected; CAS IEP attached only inside the IEP window when Kite sends it.
    """
    from universe import DESK_IDS, get as universe_get, without_paused_mcx
    from desk_tickers import merge_ticker_row, pick_quote_blob, ticker_symbol_list

    enabled = list((tracker.settings.get("enabled_indices") if tracker else None) or DESK_IDS)
    try:
        enabled = without_paused_mcx(enabled, INDEX_CONFIG)
    except Exception:
        enabled = [i for i in enabled if i in DESK_IDS]
    extra = []
    for uid in enabled:
        cfg = INDEX_CONFIG.get(uid) or {}
        qsym = cfg.get("quote_symbol")
        if tracker and tracker.kite_service:
            try:
                qsym = tracker.kite_service.resolve_quote_symbol(cfg) or qsym
            except Exception:
                pass
        u = universe_get(uid) or {}
        if qsym:
            extra.append((uid, qsym, u.get("label") or uid))
    symbols = ticker_symbol_list(enabled, index_config=INDEX_CONFIG, extra=extra)

    async def _snap_for(idx: str) -> dict:
        snap = (tracker.last_snapshot or {}).get(idx) if tracker else None
        if snap and snap.get("price"):
            return snap
        try:
            doc = await db.oi_snapshots.find_one(
                {"index": idx},
                sort=[("timestamp", -1)],
                projection={"_id": 0, "price": 1, "atm": 1, "timestamp": 1, "prev_close": 1, "day_open": 1},
            )
            return doc or {}
        except Exception:
            return {}

    kite_data = None
    if tracker and tracker.mode == "kite" and tracker.kite_service:
        try:
            kite = tracker.kite_service.kite
            keys = [s[1] for s in symbols]
            kite_data = await asyncio.to_thread(kite.quote, keys)
        except Exception as e:
            logger.warning("tickers kite failed, using snapshots: %s", e)
            kite_data = None

    include_iep = is_cas_iep_window()
    fetched_at = datetime.now(timezone.utc).isoformat()
    result = []
    for internal, symbol, label in symbols:
        snap = await _snap_for(internal)
        blob = pick_quote_blob(kite_data, symbol) if kite_data else {}
        result.append(merge_ticker_row(
            internal,
            label,
            kite_blob=blob,
            snap=snap,
            fetched_at=fetched_at,
            include_iep=include_iep,
            step=int((INDEX_CONFIG.get(internal) or {}).get("step") or 50) or 50,
        ))
    return {"mode": tracker.mode if tracker else "offline", "tickers": result, "fetched_at": fetched_at}


@api_router.get("/tickers")
async def get_tickers():
    return _public_ticker_payload(await _desk_ticker_payload())


# ------------------- Extra tickers: VIX + GIFT NIFTY -------------------
@api_router.get("/tickers/extras")
async def get_extra_tickers():
    """Live snapshot of India VIX + GIFT NIFTY, refreshed by the background
    `extra_tickers` service on its own schedule:
    - VIX: 09:15–15:40 IST
    - GIFT NIFTY: 06:30–15:40 IST and 16:35–02:45 IST
    Mon–Fri. Returns last-known values outside those windows."""
    return _public_extra_tickers_payload(extra_tickers.snapshot())


# ------------------- FII / DII (NSE cash market, EOD) -------------------
@api_router.get("/market/fii-dii")
async def get_fii_dii():
    """Latest provisional FII/FPI & DII cash activity (₹ crores).

    Pulled from NSE `fiidiiTradeReact` around 19:31 IST on trading days.
    """
    return fii_dii.snapshot()


@api_router.post("/admin/fii-dii/refresh")
async def admin_refresh_fii_dii(_admin: bool = Depends(require_admin)):
    """Admin force-refresh of NSE FII/DII (useful if the evening pull missed)."""
    return await fii_dii.refresh(reason="admin")


class RefreshDayIn(BaseModel):
    force: Optional[bool] = False


# ------------------- Admin: refresh today's OI data -------------------
@api_router.post("/admin/refresh-day")
async def admin_refresh_day(
    payload: RefreshDayIn = RefreshDayIn(),
    _admin: bool = Depends(require_admin),
):
    """FRESH PULL — wipe OI snapshots and live-pull every ENABLED index in one click.

    Uses admin `enabled_indices` (falls back to all known indices). Historical
    OI ticks cannot be recovered from Kite, so there is no synthetic backfill:
    we take one live snapshot per enabled index (in parallel) when Kite mode is
    active, then normal polling continues. Offline mode only clears the DB.

    On weekend/holiday requires force=true (second admin confirmation in UI).
    """
    force = bool(getattr(payload, "force", False))
    if (is_weekend(datetime.now(IST)) or is_full_holiday(datetime.now(IST))) and not force:
        raise HTTPException(
            400,
            "Fresh Pull is disabled on weekends/holidays so the last trading "
            "session remains available for review. Confirm again to force, or "
            "try again on the next trading day.",
        )
    today_ist = datetime.now(IST).date()
    day_start_utc = datetime.combine(
        today_ist, datetime.min.time().replace(hour=9, minute=15)
    ).replace(tzinfo=IST).astimezone(timezone.utc)

    # 1) Clear ALL snapshots — today's session (which we are about to rebuild)
    #    AND anything left over from previous days (which was causing the
    #    "previous day is being pulled" complaint after a Fresh Pull, because
    #    the history endpoints return everything within the retention window).
    deleted = await db.oi_snapshots.delete_many({})
    tracker.last_snapshot = {}  # force /change endpoint to re-fetch
    logger.info(
        f"[admin/refresh-day] deleted {deleted.deleted_count} snapshots (full wipe) — "
        f"today session start {day_start_utc.isoformat()}"
    )

    from oi_service import INDEX_CONFIG
    from market_hours import display_hours

    enabled = [
        i for i in (tracker.settings.get("enabled_indices") or list(INDEX_CONFIG.keys()))
        if i in INDEX_CONFIG
    ]
    if not enabled:
        enabled = list(INDEX_CONFIG.keys())

    # 2) Backfill strategy depends on whether Kite credentials are present:
    #    • KITE MODE  → NO synthetic backfill. Kite only supplies live ticks,
    #                   so fabricating history would show FAKE OI values that
    #                   don't match reality. Instead we take ONE live Kite
    #                   snapshot per enabled index at "now" and rely on the
    #                   tracker's normal poll to fill in the rest going forward.
    #    • OFFLINE    → skip synthetic backfill (no fake data).
    backfilled = 0
    per_index_count = {idx: 0 for idx in enabled}
    live_pulled: List[str] = []
    now_ist_now = datetime.now(IST)
    session_start = datetime.combine(
        today_ist, datetime.min.time().replace(hour=9, minute=15)
    ).replace(tzinfo=IST)
    _, close_hm = display_hours()
    try:
        ch, cm = [int(x) for x in close_hm.split(":")[:2]]
    except Exception:
        ch, cm = 15, 40
    session_end = min(
        now_ist_now,
        datetime.combine(
            today_ist, datetime.min.time().replace(hour=ch, minute=cm)
        ).replace(tzinfo=IST),
    )

    if tracker.mode == "kite" and tracker.kite_service:
        # Real-data-only: one live poll per ENABLED index in parallel.
        ksvc = tracker.kite_service

        async def _pull(idx: str):
            try:
                snap = await asyncio.wait_for(
                    asyncio.to_thread(ksvc.get_snapshot, idx, tracker.selected_expiry.get(idx)),
                    timeout=15.0,
                )
                return idx, snap, None
            except Exception as e:
                return idx, None, e

        results = await asyncio.gather(*[_pull(idx) for idx in enabled])
        for idx, snap, err in results:
            if err is not None:
                logger.warning(f"[refresh kite-live] {idx}: {err}")
                continue
            if snap:
                snap["mode"] = "kite"
                snap["source"] = "live"
                tracker.last_snapshot[idx] = snap
                await _store_oi_snapshot(snap, index_name=idx)
                per_index_count[idx] += 1
                backfilled += 1
                live_pulled.append(idx)
    else:
        # OFFLINE mode (no Kite credentials): DO NOT synthesize or backfill
        # mock/demo data. Creating synthetic history would expose fake values to
        # end users which is unacceptable in production. Instead, simply leave
        # the DB empty (we already cleared it above) and report that the
        # backfill was skipped due to missing credentials.
        logger.info("[admin/refresh-day] offline mode: skipping synthetic backfill (no Kite credentials configured)")
        # backfilled remains 0

    # 3) Immediate live poll for ALL enabled indices when market is open — skipped if
    #    step 2 already performed the kite live pull (avoids double Kite quotes).
    if tracker.oi_session_open():
        if tracker.mode == "kite" and tracker.kite_service and not live_pulled:
            try:
                svc = tracker._get_service()

                async def _live(idx: str):
                    try:
                        snap = await asyncio.wait_for(
                            asyncio.to_thread(svc.get_snapshot, idx, tracker.selected_expiry.get(idx)),
                            timeout=15.0,
                        )
                        return idx, snap, None
                    except Exception as e:
                        return idx, None, e

                for idx, snap, err in await asyncio.gather(*[_live(idx) for idx in enabled]):
                    if err is not None:
                        logger.warning(f"[refresh live-poll] {idx}: {err}")
                        continue
                    if snap:
                        snap["mode"] = tracker.mode
                        snap["source"] = "live"
                        tracker.last_snapshot[idx] = snap
                        await _store_oi_snapshot(snap, index_name=idx)
                        live_pulled.append(idx)
            except Exception as e:
                logger.warning(f"[admin/refresh-day] live poll block failed: {e}")
        elif tracker.mode != "kite":
            logger.info("[admin/refresh-day] market open but tracker offline — skipping immediate live poll")
    else:
        # After close: seed `last_snapshot` from the last backfilled document so
        # /oi/{idx}/change serves the correct final tick immediately.
        for idx in enabled:
            doc = await db.oi_snapshots.find_one(
                {"index": idx},
                sort=[("timestamp", -1)],
                projection={"_id": 0},
            )
            if doc:
                tracker.last_snapshot[idx] = doc

    # 4) Nudge extra-tickers so header VIX / GIFT NIFTY refresh too.
    try:
        await extra_tickers.force_refresh()
    except Exception:
        pass

    successful_indices = [i for i, c in per_index_count.items() if c > 0]

    return {
        "ok": True,
        "deleted": deleted.deleted_count,
        "backfilled_snapshots": backfilled,
        "per_index_count": per_index_count,
        "indices_backfilled": successful_indices,
        "live_indices_pulled": live_pulled,
        "enabled_indices": enabled,
        "mode": tracker.mode,
        "session_start_ist": session_start.isoformat(),
        "session_end_ist": session_end.isoformat(),
        "message": (
            f"Fresh Pull complete. Cleared {deleted.deleted_count} old snapshots and "
            f"pulled live ticks for {', '.join(live_pulled) or 'none'} "
            f"(enabled: {', '.join(enabled)}). Live polling continues automatically."
        ),
    }


def _friendly_kite_connect_error(exc: Exception) -> str:
    raw = str(exc or "")
    low = raw.lower()
    if "not enabled for the app" in low:
        return "This broker account is not enabled for the configured app. Ask the desk administrator to check account access."
    if "token" in low and ("expired" in low or "invalid" in low):
        return "Broker login expired or was reused. Start a new broker login and try once more."
    if "checksum" in low:
        return "The broker login token was invalid. Start a new broker login and try again."
    # Provider error pages can include full HTML bodies; keep those out of API banners.
    if "text/html" in low or re.search(r"<!doctype\s+html|<html\b|<body\b", raw, flags=re.IGNORECASE):
        if "503" in low or "service unavailable" in low:
            return "Broker service is temporarily unavailable. Please try again shortly."
        return "Broker service returned an unexpected response. Please try again shortly."
    safe = re.sub(
        r"https?://(?:developers\.)?kite\.tech\S*|https?://(?:api\.)?kite\.trade\S*|https?://kite\.zerodha\.com\S*|https?://(?:www\.)?zerodha\.com\S*",
        "broker service",
        raw,
        flags=re.IGNORECASE,
    )
    safe = re.sub(r"\b(?:zerodha|kite\s*connect|kiteticker|kite)\b", "broker", safe, flags=re.IGNORECASE)
    return safe or "Broker login failed"


# ------------------- Zerodha positions -------------------
class UserKiteSessionIn(BaseModel):
    request_token: str


class UserKiteCredentialsIn(BaseModel):
    api_key: str
    api_secret: str


@api_router.get("/kite/user/status")
async def kite_user_status(request: Request, role: str = Depends(require_desk_user)):
    from user_kite import public_status
    if role == "admin":
        uid = getattr(tracker, "kite_user_id", None) if tracker else None
        connected = bool(tracker and tracker.kite_service and tracker.mode == "kite")
        return {
            "role": "admin",
            "connected": connected,
            "expired": False,
            "kite_user_id": uid,
            "publisher": True,
        }
    guest = await _guest_from_request(request)
    if guest and guest.get("member_id"):
        await _member_context(request, "positions")
    doc = await _load_user_kite_doc(guest)
    st = public_status(doc)
    if guest and guest.get("member_id"):
        api_key = _decrypt_safe(doc.get("api_key_enc")) if doc else None
        api_secret = _decrypt_safe(doc.get("api_secret_enc")) if doc else None
        return {
            "role": "member",
            "publisher": False,
            "linked_kite_user_id": (guest.get("member") or {}).get("linked_kite_user_id"),
            "credentials_configured": bool(api_key and api_secret),
            "api_key_hint": f"••••{api_key[-4:]}" if api_key else None,
            "credentials_updated_at": doc.get("credentials_updated_at") if doc else None,
            "member_name": guest.get("name"),
            "member_email": guest.get("email"),
            **st,
        }
    key, secret = await _publisher_api_key_secret()
    return {
        "role": "guest",
        "publisher": False,
        "app_ready": bool(key and secret),
        **st,
    }


@api_router.put("/kite/user/credentials")
async def save_user_kite_credentials(
    payload: UserKiteCredentialsIn,
    request: Request,
    role: str = Depends(require_desk_user),
):
    if role != "guest":
        raise HTTPException(400, "Admin credentials are managed in the admin credentials screen.")
    guest = await _guest_from_request(request)
    if not guest:
        raise HTTPException(401, "Sign in required")
    member_id = guest.get("member_id")
    if not member_id:
        raise HTTPException(403, "Personal broker app credentials are available to Pro members.")
    await _member_context(request, "positions")
    api_key = str(payload.api_key or "").strip()
    api_secret = str(payload.api_secret or "").strip()
    if not api_key or not api_secret:
        raise HTTPException(422, "Enter both your broker API key and API secret.")
    if len(api_key) > 256 or len(api_secret) > 1024:
        raise HTTPException(422, "Broker credentials exceed the supported length.")
    if db is None:
        raise HTTPException(503, "Database unavailable")

    now = datetime.now(timezone.utc).isoformat()
    previous = await db.user_kite.find_one(
        {"member_id": member_id},
        {"_id": 1, "api_key_enc": 1, "api_secret_enc": 1, "kite_user_id": 1},
    )
    if previous and previous.get("kite_user_id"):
        await _bind_member_kite_identity(member_id, previous["kite_user_id"])
    await db.user_kite.update_one(
        {"member_id": member_id},
        {
            "$set": {
                "_id": f"member:{member_id}",
                "member_id": member_id,
                "api_key_enc": _fernet().encrypt(api_key.encode()).decode(),
                "api_secret_enc": _fernet().encrypt(api_secret.encode()).decode(),
                "credentials_updated_at": now,
                "updated_at": now,
            },
            # A token signed by a different app key must never be reused.
            "$unset": {
                "access_token_enc": "",
                "kite_user_id": "",
                "valid_until": "",
            },
        },
        upsert=True,
    )
    await _record_member_audit(
        member_id,
        "broker_credentials_saved",
        "member",
        {"replaced": bool(previous and previous.get("api_key_enc") and previous.get("api_secret_enc"))},
    )
    return {"ok": True, "credentials_configured": True, "connected": False}


@api_router.get("/membership/broker-credentials")
async def membership_broker_credentials_status(request: Request):
    session = await _member_session_from_request(request)
    if not session:
        raise HTTPException(401, "Member sign-in required")
    member_id = session["member_id"]
    doc = await db.user_kite.find_one(
        {"member_id": member_id},
        {"api_key_enc": 1, "api_secret_enc": 1, "access_token_enc": 1,
         "kite_user_id": 1, "valid_until": 1, "credentials_updated_at": 1},
    ) if db is not None else None
    member = await db.members.find_one(
        {"_id": member_id},
        {"linked_kite_user_id": 1},
    ) if db is not None else None
    from user_kite import public_status
    api_key = _decrypt_safe(doc.get("api_key_enc")) if doc else None
    api_secret = _decrypt_safe(doc.get("api_secret_enc")) if doc else None
    return {
        "credentials_configured": bool(api_key and api_secret),
        "api_key_hint": f"••••{api_key[-4:]}" if api_key else None,
        "credentials_updated_at": doc.get("credentials_updated_at") if doc else None,
        "linked_kite_user_id": (member or {}).get("linked_kite_user_id"),
        **public_status(doc),
    }


@api_router.delete("/membership/broker-credentials")
async def delete_user_kite_credentials(request: Request):
    session = await _member_session_from_request(request)
    if not session:
        raise HTTPException(401, "Member sign-in required")
    member_id = session["member_id"]
    if db is None:
        raise HTTPException(503, "Database unavailable")
    previous = await db.user_kite.find_one(
        {"member_id": member_id},
        {"kite_user_id": 1},
    )
    if previous and previous.get("kite_user_id"):
        await _bind_member_kite_identity(member_id, previous["kite_user_id"])
    result = await db.user_kite.delete_one({"member_id": member_id})
    if result.deleted_count:
        await _record_member_audit(member_id, "broker_credentials_deleted", "member")
    return {"ok": True, "credentials_configured": False, "connected": False}


@api_router.get("/kite/user/callback")
async def kite_user_callback(
    request: Request,
    request_token: Optional[str] = None,
    status: Optional[str] = None,
):
    """Bridge Kite's registered server callback to the SPA token exchange page."""
    from fastapi.responses import RedirectResponse
    from kite_callback_origin import kite_spa_origin
    origin = kite_spa_origin(request)
    from urllib.parse import urlencode

    qs = urlencode({
        key: value
        for key, value in {
            "request_token": request_token,
            "status": status,
        }.items()
        if value
    })
    dest = f"{origin}/kite-callback"
    if qs:
        dest = f"{dest}?{qs}"
    return RedirectResponse(dest, status_code=302)


@api_router.get("/kite/user/login-url")
async def kite_user_login_url(request: Request, _role: str = Depends(require_desk_user)):
    sess = await _member_session_from_request(request)
    if sess:
        await _member_context(request, "positions")
        doc = await _load_user_kite_doc(sess)
        key = _decrypt_safe(doc.get("api_key_enc")) if doc else None
        secret = _decrypt_safe(doc.get("api_secret_enc")) if doc else None
        if not key or not secret:
            raise HTTPException(400, "Save your broker API key and API secret before generating a login link.")
    else:
        key, secret = await _publisher_api_key_secret()
    if not key or not secret:
        raise HTTPException(400, "Publisher broker app is not configured (API key + secret).")
    from kite_callback_origin import kite_spa_origin
    from urllib.parse import urlencode
    redirect_uri = f"{kite_spa_origin(request)}/api/kite/user/callback"
    return {
        "login_url": "https://kite.zerodha.com/connect/login?" + urlencode({"v": "3", "api_key": key}),
        "redirect_uri": redirect_uri,
        "hint": f"Set your broker app redirect URL to exactly {redirect_uri}.",
    }


@api_router.post("/kite/user/session")
async def kite_user_session(payload: UserKiteSessionIn, request: Request, role: str = Depends(require_desk_user)):
    """Exchange request_token for a per-user access_token. Never writes the publisher OI vault."""
    if role != "guest":
        raise HTTPException(400, "Admin desk uses Credentials / daily refresh, not guest broker login.")
    guest = await _guest_from_request(request)
    if not guest:
        raise HTTPException(401, "Guest session required")
    if guest.get("member_id"):
        await _member_context(request, "positions")
    req = str(payload.request_token or "").strip()
    if not req:
        raise HTTPException(400, "request_token required")
    if guest.get("member_id"):
        doc = await _load_user_kite_doc(guest)
        key = _decrypt_safe(doc.get("api_key_enc")) if doc else None
        secret = _decrypt_safe(doc.get("api_secret_enc")) if doc else None
        if not key or not secret:
            raise HTTPException(400, "Save your broker API key and API secret before connecting.")
    else:
        key, secret = await _publisher_api_key_secret()
    if not key or not secret:
        raise HTTPException(400, "Publisher broker app is not configured.")
    try:
        from kiteconnect import KiteConnect
        kc = KiteConnect(api_key=key)
        data = kc.generate_session(req, api_secret=secret)
        access_token = data.get("access_token")
        if not access_token:
            raise RuntimeError("No access_token returned by Kite")
    except HTTPException:
        raise
    except Exception as e:
        detail = (
            "Broker login was not accepted. Check the request token and saved credentials, then try again."
            if guest.get("member_id")
            else _friendly_kite_connect_error(e)
        )
        raise HTTPException(400, detail)
    uid = data.get("user_id")
    if guest.get("member_id"):
        await _bind_member_kite_identity(guest["member_id"], uid)
    saved = await _save_user_kite(guest, access_token=access_token, kite_user_id=uid)
    return {
        "ok": True,
        "kite_user_id": uid,
        "valid_until": saved.get("valid_until"),
        "connected": True,
    }


@api_router.post("/kite/user/disconnect")
async def kite_user_disconnect(request: Request, role: str = Depends(require_desk_user)):
    if role != "guest":
        raise HTTPException(400, "Admin desk uses Credentials to sign out of the broker.")
    guest = await _guest_from_request(request)
    if not guest:
        raise HTTPException(401, "Guest session required")
    if guest.get("member_id"):
        # Daily sign-out must not force Pro members to re-enter long-lived app keys.
        await db.user_kite.update_one(
            {"member_id": guest["member_id"]},
            {"$unset": {
                "access_token_enc": "",
                "kite_user_id": "",
                "valid_until": "",
            }},
        )
        await _record_member_audit(guest["member_id"], "broker_session_disconnected", "member")
    else:
        await db.guest_sessions.update_one(
            {"_id": guest["_id"]},
            {"$unset": {"kite_access_token_enc": "", "kite_user_id": "", "kite_valid_until": ""}},
        )
        await db.user_kite.update_many(
            {"guest_token": guest["_id"]},
            {"$unset": {"access_token_enc": "", "valid_until": ""}},
        )
    return {"ok": True, "connected": False}


@api_router.get("/positions")
async def get_positions(
    request: Request,
    role: str = Depends(require_desk_user),
    settle_expiry: bool = Query(False),
):
    """Fetch F&O positions from the caller's Kite book (net + day).

    Admin uses the publisher vault (same client as OI).
    Guests use their own access_token — never the publisher desk token.
    """
    kite = None
    member_session = await _member_session_from_request(request)
    member_journal_enabled = False
    if member_session:
        _, member_config, member_plan = await _member_context(request, "positions")
        from membership import plan_features
        if (
            member_session["member"].get("local_dev_test_account")
            and _is_local_dev_request(request)
        ):
            member_config = {**member_config, "experience_enabled": True}
        member_journal_enabled = "trade_journal" in plan_features(member_config, member_plan)

    async def _note_token_gap():
        try:
            oid = await _ledger_owner(request, role)
            _spawn_ledger(_persist_trade_ledger(oid, {"positions": []}, None, feed_ok=False))
        except Exception:
            pass

    if role == "guest":
        guest = await _guest_from_request(request)
        kite, st = await _user_kite_client(guest)
        if not kite:
            expired = bool(st.get("expired"))
            await _note_token_gap()
            if guest and guest.get("member_id"):
                if expired:
                    connect_message = (
                        "Today's broker session is stale. Your saved app credentials are still secure; "
                        "add today's request token to refresh your Positions."
                    )
                elif st.get("credentials_configured"):
                    connect_message = (
                        "Your broker app credentials are saved securely. Add today's request token "
                        "to connect and load your Positions."
                    )
                else:
                    connect_message = (
                        "Save your broker API key and secret once, then add a fresh request token "
                        "each trading day to load your Positions."
                    )
            else:
                connect_message = (
                    "Your broker login expired around 06:00 IST. Reconnect to load today's book."
                    if expired
                    else "Connect your broker account to load your positions."
                )
            return {
                "mode": "user",
                "positions": [],
                "funds": None,
                "error": connect_message,
                "kite_connected": False,
                "connect_required": True,
                "user_kite": st,
                "transient": False,
                "token_issue": True,
            }
    else:
        # Prefer the live Kite client — do not drop Positions just because the OI
        # poller mode flag briefly flipped offline.
        if tracker is None or not tracker.kite_service:
            await _note_token_gap()
            return {
                "mode": getattr(tracker, "mode", None) or "offline",
                "positions": [],
                "funds": None,
                "error": "Broker not connected. Add the API key and access token in Credentials.",
                "kite_connected": False,
                "transient": False,
                "token_issue": True,
            }
        # Respect intentional offline — do not auto-heal mode back to kite.
        if tracker.mode != "kite":
            if getattr(tracker, "offline_sticky", False):
                return {
                    "mode": tracker.mode,
                    "positions": [],
                    "funds": None,
                    "error": "Broker is offline. Switch to LIVE (or reconnect) to pull positions.",
                    "kite_connected": False,
                    "transient": False,
                    "token_issue": False,
                }
        kite = tracker.kite_service.kite

    logger.info("positions book role=%s", role)

    try:
        raw = await asyncio.wait_for(asyncio.to_thread(kite.positions), timeout=10)
        net = raw.get("net", []) if isinstance(raw, dict) else (raw or [])
        day = raw.get("day", []) if isinstance(raw, dict) else []
        if role == "admin":
            err_low = (tracker.last_error or "").lower()
            if any(
                k in err_low
                for k in (
                    "tokenexception",
                    "invalid token",
                    "incorrect `api_key`",
                    "incorrect api_key",
                    "access_token",
                )
            ):
                tracker.last_error = None
    except Exception as e:
        msg = f"{type(e).__name__}: {e}"
        low = msg.lower()
        tokenish = any(
            k in low
            for k in (
                "tokenexception",
                "invalid token",
                "access_token",
                "incorrect `api_key`",
                "incorrect api_key",
                "unauthorized",
                "forbidden",
            )
        )
        if tokenish and role == "admin":
            tracker.last_error = msg
        if tokenish and role == "guest":
            await _note_token_gap()
            member_book = bool(guest and guest.get("member_id"))
            if member_book:
                await db.user_kite.update_one(
                    {"member_id": guest["member_id"]},
                    {"$unset": {
                        "access_token_enc": "",
                        "kite_user_id": "",
                        "valid_until": "",
                    }},
                )
                st = {**st, "connected": False, "expired": True}
            return {
                "mode": "user",
                "positions": [],
                "funds": None,
                "error": (
                    "Today's broker session is stale or was rejected. Add a fresh request token "
                    "to refresh your Positions."
                    if member_book
                    else "Your broker login expired or was rejected. Reconnect your broker for today's book."
                ),
                "kite_connected": False,
                "connect_required": True,
                **({"user_kite": st} if role == "guest" else {}),
                "transient": False,
                "token_issue": True,
            }
        try:
            from kite_maintenance import notice_from_error, merge_maintenance

            note = notice_from_error(msg)
            if note:
                tracker.kite_maintenance = merge_maintenance(
                    tracker.kite_maintenance, api_error=msg
                )
            elif not tokenish:
                # Successful non-maintenance path clears sticky API maintenance later.
                pass
        except Exception:
            pass
        maint = tracker.kite_maintenance if isinstance(tracker.kite_maintenance, dict) else None
        err_out = f"Broker error: {_friendly_kite_connect_error(Exception(msg))}"
        if maint and maint.get("active") and maint.get("message"):
            err_out = f"Broker service maintenance: {_friendly_kite_connect_error(Exception(maint.get('message')))}"
        if tokenish:
            await _note_token_gap()
        return {
            "mode": tracker.mode,
            "positions": [],
            "funds": None,
            "error": err_out,
            "kite_connected": True,
            **({"user_kite": st} if role == "guest" else {}),
            "transient": not tokenish,
            "token_issue": tokenish,
            "maintenance": bool(maint and maint.get("active")),
        }

    # Read-only funds snapshot (never places trades).
    funds = None
    try:
        # Prefer equity segment directly — F&O cash lives here.
        try:
            eq = await asyncio.to_thread(kite.margins, "equity")
        except TypeError:
            eq = None
        except Exception:
            eq = None
        if not isinstance(eq, dict) or not eq:
            margins = await asyncio.to_thread(kite.margins)
            eq = (margins or {}).get("equity") or {}
        avail = eq.get("available") or {}
        util = eq.get("utilised") or {}
        # IMPORTANT: never reuse the name `net` — that holds positions().net above.
        funds_net = eq.get("net")
        if funds_net is None:
            funds_net = avail.get("live_balance")
        if funds_net is None:
            funds_net = avail.get("cash")
        funds = {
            "net": funds_net,
            "cash": avail.get("cash"),
            "live_balance": avail.get("live_balance"),
            "opening_balance": avail.get("opening_balance"),
            "intraday_payin": avail.get("intraday_payin"),
            "collateral": avail.get("collateral"),
            "utilised_debits": util.get("debits"),
            "span": util.get("span"),
            "exposure": util.get("exposure"),
            "option_premium": util.get("option_premium"),
            "m2m_unrealised": util.get("m2m_unrealised"),
            "m2m_realised": util.get("m2m_realised"),
        }
        try:
            cm = await asyncio.to_thread(kite.margins, "commodity")
        except TypeError:
            cm = None
        except Exception:
            cm = None
        if isinstance(cm, dict) and cm:
            cm_avail = cm.get("available") or {}
            cm_util = cm.get("utilised") or {}
            funds["commodity_net"] = cm.get("net")
            funds["commodity_cash"] = cm_avail.get("cash")
            funds["commodity_live_balance"] = cm_avail.get("live_balance")
            funds["commodity_opening_balance"] = cm_avail.get("opening_balance")
            funds["commodity_intraday_payin"] = cm_avail.get("intraday_payin")
            funds["commodity_collateral"] = cm_avail.get("collateral")
            funds["commodity_utilised_debits"] = cm_util.get("debits")
        from account_equity import total_trading_equity
        book = total_trading_equity(funds)
        funds["total"] = book["total"]
        funds["available"] = book["available"]
        funds["base"] = book["total"]
        funds["kite_has_withdrawals"] = False
    except Exception as e:
        logger.warning("kite.margins failed: %s", e)

    from fno_symbol import (
        booked_pnl_from_kite_row,
        format_fno_option_label,
        parse_fno_option_symbol,
    )
    from kite_positions import (
        apply_live_ltp_to_open_rows,
        booked_today_from_row,
        lot_sizes_by_tradingsymbol,
        merge_kite_net_day,
        settle_expiry_floor_hedges,
    )
    from universe import match_symbol_prefix

    # Net quantity is authoritative for open vs exited. Day rows only enrich
    # buy/sell stats — never resurrect a flat net as an open leg.
    try:
        merged = merge_kite_net_day(net, day)
    except Exception as e:
        logger.exception("positions merge failed: %s", e)
        return {
            "mode": tracker.mode,
            "positions": [],
            "funds": funds,
            "error": f"Positions merge error: {type(e).__name__}: {e}",
            "kite_connected": True,
            "transient": True,
            "token_issue": False,
        }

    inst_df = getattr(tracker.kite_service, "instruments_df", None) if getattr(tracker, "kite_service", None) else None
    lot_map = lot_sizes_by_tradingsymbol(
        inst_df,
        [p.get("tradingsymbol") for p in merged if isinstance(p, dict)],
    )

    out = []
    for p in merged:
        qty = int(p.get("quantity", 0) or 0)
        buy_qty = int(p.get("buy_quantity", 0) or 0)
        sell_qty = int(p.get("sell_quantity", 0) or 0)
        # Skip untouched / empty rows. Keep same-day exits (flat but traded today).
        # Never drop GOLD / CRUDE / stocks / FINNIFTY — Kite net+day is the full book.
        if qty == 0 and buy_qty == 0 and sell_qty == 0:
            continue
        exited = qty == 0 and (buy_qty > 0 or sell_qty > 0)
        ts = p.get("tradingsymbol", "")
        parsed = parse_fno_option_symbol(ts) or {}
        if not parsed.get("index"):
            prefix = match_symbol_prefix(ts)
            if prefix:
                parsed = {**parsed, "index": prefix}
        buy_price = float(p.get("buy_price", 0) or 0)
        sell_price = float(p.get("sell_price", 0) or 0)
        avg = float(p.get("average_price", 0) or 0)
        buy_value = float(p.get("buy_value", 0) or 0)
        sell_value = float(p.get("sell_value", 0) or 0)
        last_price = float(p.get("last_price", 0) or 0)
        multiplier = float(p.get("multiplier", 1) or 1) or 1.0
        pnl_bits = booked_pnl_from_kite_row(
            qty=qty,
            buy_qty=buy_qty,
            sell_qty=sell_qty,
            buy_price=buy_price,
            sell_price=sell_price,
            pnl=float(p.get("pnl", 0) or 0),
            realised=float(p.get("realised", 0) or 0),
            unrealised=float(p.get("unrealised", 0) or 0),
            exited=exited,
            buy_value=buy_value,
            sell_value=sell_value,
            last_price=last_price,
            multiplier=multiplier,
        )
        # Direction hint for exited shorts/longs (qty is 0): compare buy vs sell volume.
        side_bias = None
        if exited:
            if sell_qty > buy_qty:
                side_bias = "short"
            elif buy_qty > sell_qty:
                side_bias = "long"
            else:
                side_bias = "squared"
        display_name = format_fno_option_label(ts, parsed=parsed or None)
        # Mirror Kite Positions: flat legs show Qty 0 / Avg 0.00 with Closed tag.
        out.append({
            "tradingsymbol": ts,
            "display_name": display_name,
            "exchange": p.get("exchange"),
            "product": p.get("product"),
            "quantity": 0 if exited else qty,
            "overnight_quantity": int(p.get("overnight_quantity", 0) or 0),
            "day_quantity": int(p.get("day_quantity", 0) or 0) if p.get("day_quantity") is not None else None,
            "average_price": 0.0 if exited else avg,
            "average_price_raw": avg,
            "last_price": last_price,
            "pnl": pnl_bits["pnl"],
            "unrealised": pnl_bits["unrealised"],
            "realised": pnl_bits["realised"],
            "booked_pnl": pnl_bits["booked_pnl"],
            "partial": bool(pnl_bits.get("partial")),
            "closed_quantity": int(pnl_bits.get("closed_quantity") or 0),
            "pnl_source": pnl_bits["pnl_source"],
            "buy_quantity": buy_qty,
            "sell_quantity": sell_qty,
            "buy_price": buy_price,
            "sell_price": sell_price,
            "buy_value": buy_value or None,
            "sell_value": sell_value or None,
            "multiplier": multiplier,
            "lot_size": lot_map.get(ts),
            "exited": exited,
            "is_exited": exited,
            "position_state": "closed" if exited else "open",
            "status": "Closed" if exited else None,
            "side_bias": side_bias,
            **parsed,
        })

    # Open legs first, then same-day exits (stable by symbol).
    out.sort(key=lambda r: (1 if r.get("exited") else 0, str(r.get("tradingsymbol") or "")))

    # Per-index spot: ALWAYS refresh from Kite quote for every index in the book
    # so NIFTY/SENSEX legs never inherit whichever dashboard tab is open.
    # Snapshot used only as secondary atm/OI context.
    idx_spot = {}
    oi_by_index = {}
    indices_needed = []
    for pos in out:
        idx = pos.get("index")
        if idx and idx in INDEX_CONFIG and idx not in indices_needed:
            indices_needed.append(idx)

    quotes = {}
    index_keys = [INDEX_CONFIG[i]["quote_symbol"] for i in indices_needed]
    leg_keys = []
    for pos in out:
        if pos.get("exited"):
            continue
        ex, ts = pos.get("exchange"), pos.get("tradingsymbol")
        if ex and ts:
            leg_keys.append(f"{ex}:{ts}")
    leg_keys = list(dict.fromkeys(leg_keys))
    if tracker.kite_service:
        for keys, label in ((index_keys, "index"), (leg_keys, "open-leg")):
            if not keys:
                continue
            try:
                quoted = await asyncio.wait_for(asyncio.to_thread(kite.quote, keys), timeout=8)
                quotes.update(quoted or {})
            except Exception as e:
                logger.warning("positions %s kite.quote failed: %s", label, e)

    # Tile totals from Kite Booked / Unbooked / P&L — before quote MTM on open legs.
    def _row_day_pnl(r: dict) -> float:
        if r.get("exited"):
            for key in ("booked_pnl", "realised", "pnl"):
                try:
                    v = float(r.get(key))
                except (TypeError, ValueError):
                    continue
                if v == v:  # not NaN
                    return v
            return 0.0
        try:
            return float(r.get("pnl") or 0)
        except (TypeError, ValueError):
            return 0.0

    open_n = sum(1 for r in out if not r.get("exited"))
    exited_n = sum(1 for r in out if r.get("exited"))
    partial_n = sum(1 for r in out if r.get("partial") and not r.get("exited"))
    open_pnl = round(sum(_row_day_pnl(r) for r in out if not r.get("exited")), 2)
    exited_pnl = round(sum(_row_day_pnl(r) for r in out if r.get("exited")), 2)
    booked_today = round(sum(booked_today_from_row(r) for r in out), 2)
    # Kite Total P&L = sum of the P/L column. Booked is realised on closed +
    # still-open partials. Unbooked is the rest (not raw API unrealised — that
    # field is often the whole MTM).
    kite_total = round(open_pnl + exited_pnl, 2)
    unbooked = round(kite_total - booked_today, 2)
    pnl_today = {
        "open": unbooked,
        "exited": exited_pnl,
        "booked": booked_today,
        "unbooked": unbooked,
        "total": kite_total,
    }

    apply_live_ltp_to_open_rows(out, quotes)

    _, close_hm = display_hours()
    force_settle = bool(settle_expiry)
    settled_n = settle_expiry_floor_hedges(
        out,
        now=now_ist(),
        market_close_ist=close_hm,
        force=force_settle,
    )
    leftover_open = sum(1 for r in out if r.get("can_settle_in_book"))
    open_n = sum(1 for r in out if not r.get("exited"))
    exited_n = sum(1 for r in out if r.get("exited"))
    partial_n = sum(1 for r in out if r.get("partial") and not r.get("exited"))
    open_pnl = round(sum(_row_day_pnl(r) for r in out if not r.get("exited")), 2)
    exited_pnl = round(sum(_row_day_pnl(r) for r in out if r.get("exited")), 2)
    booked_today = round(sum(booked_today_from_row(r) for r in out), 2)
    kite_total = round(open_pnl + exited_pnl, 2)
    unbooked = round(kite_total - booked_today, 2)
    pnl_today = {
        "open": unbooked,
        "exited": exited_pnl,
        "booked": booked_today,
        "unbooked": unbooked,
        "total": kite_total,
    }

    for idx in indices_needed:
        qkey = INDEX_CONFIG[idx]["quote_symbol"]
        q = quotes.get(qkey) or {}
        lp = q.get("last_price") or (q.get("ohlc") or {}).get("close")
        try:
            lp_f = float(lp) if lp is not None else None
        except (TypeError, ValueError):
            lp_f = None

        snap = tracker.last_snapshot.get(idx) or {}
        snap_price = None
        try:
            snap_price = float(snap["price"]) if snap.get("price") is not None else None
        except (TypeError, ValueError):
            snap_price = None

        price_f = lp_f if (lp_f and lp_f > 0) else snap_price
        atm = snap.get("atm")
        try:
            atm_f = float(atm) if atm is not None else None
        except (TypeError, ValueError):
            atm_f = None
        if price_f and price_f > 0:
            idx_spot[idx] = {
                "price": price_f,
                "atm": atm_f if (atm_f and atm_f > 0) else price_f,
                "source": "kite_quote" if (lp_f and lp_f > 0) else "snapshot",
                "vix": snap.get("vix"),
            }
        # Compact OI chain for Analyze overlay (read-only, from in-memory snapshot)
        strikes = snap.get("strikes") or []
        if strikes:
            oi_by_index[idx] = {
                "price": price_f or snap_price,
                "atm": atm_f,
                "vix": snap.get("vix"),
                "expiry": snap.get("expiry"),
                "strikes": [
                    {
                        "strike": s.get("strike"),
                        "ce_oi": s.get("ce_oi") or 0,
                        "pe_oi": s.get("pe_oi") or 0,
                        "ce_ltp": s.get("ce_ltp"),
                        "pe_ltp": s.get("pe_ltp"),
                    }
                    for s in strikes
                    if s.get("strike") is not None
                ],
            }

    if isinstance(funds, dict):
        try:
            from account_equity import booked_pct as equity_booked_pct
            from account_equity import choose_funds_base, pnl_after_charges
            day_iso = journal.journal_session_ymd()
            wallet = funds.get("total")
            jdoc = None
            if db is not None:
                jdoc = await db.trade_journal.find_one(
                    {"date": day_iso},
                    {"funds_base": 1, "charges_total": 1, "booked_after_charges": 1},
                )
            jbase = (jdoc or {}).get("funds_base")
            base = choose_funds_base(jbase, wallet)
            if base is not None:
                funds["base"] = base
            made = pnl_after_charges(jdoc or {}, booked_today)
            pct = equity_booked_pct(made, funds.get("base") or wallet)
            pnl_today["booked_pct"] = pct
            pnl_today["booked_after_charges"] = made
            funds["booked_pct"] = pct
        except Exception:
            pass

    result = {
        "mode": tracker.mode,
        "positions": out,
        "open_count": open_n,
        "exited_count": exited_n,
        "partial_count": partial_n,
        "pnl_today": pnl_today,
        "expiry_settled_count": int(settled_n),
        "expiry_leftover_open_count": int(leftover_open),
        "spot": idx_spot,
        "oi": oi_by_index,
        "funds": funds,
        "kite_connected": True,
        "transient": False,
        "token_issue": False,
        "maintenance": False,
        **({"user_kite": st} if role == "guest" else {}),
    }
    if not out:
        try:
            from kite_maintenance import fetch_bulletin_notice, merge_maintenance, overnight_book_notice

            bulletin = fetch_bulletin_notice()
            night = overnight_book_notice()
            if not night:
                from kite_maintenance import stale_overnight_notice
                if stale_overnight_notice(tracker.kite_maintenance):
                    tracker.kite_maintenance = None
            tracker.kite_maintenance = merge_maintenance(
                tracker.kite_maintenance,
                api_error=(night or {}).get("message"),
                bulletin=bulletin,
            )
            if night and not (tracker.kite_maintenance and tracker.kite_maintenance.get("active")):
                tracker.kite_maintenance = night
            maint = tracker.kite_maintenance if isinstance(tracker.kite_maintenance, dict) else None
            if maint and maint.get("active"):
                result["maintenance"] = True
                result["error"] = f"Broker service maintenance: {_friendly_kite_connect_error(Exception(maint.get('message') or night.get('message')))}"
                result["transient"] = True
        except Exception:
            pass
    elif out:
        if isinstance(tracker.kite_maintenance, dict) and tracker.kite_maintenance.get("source") == "kite_api":
            tracker.kite_maintenance = None
    try:
        # HTTP pulls persist asynchronously; internal callers await their own snapshot.
        if role == "admin" and request is not None and not result.get("error"):
            asyncio.create_task(_snapshot_trade_journal(result, allow_locked_update=True))
    except Exception:
        pass
    if (
        role == "guest"
        and member_session
        and member_journal_enabled
        and not result.get("error")
        and not result.get("token_issue")
    ):
        asyncio.create_task(
            _snapshot_member_trade_journal(member_session["member_id"], result)
        )
    try:
        owner_id = await _ledger_owner(request, role)
        if not result.get("error") and not result.get("token_issue"):
            asyncio.create_task(_persist_trade_ledger(owner_id, result, kite, feed_ok=True))
    except Exception:
        pass
    return result


def _ist_today_ymd() -> str:
    from datetime import datetime, timezone, timedelta
    ist = timezone(timedelta(hours=5, minutes=30))
    return datetime.now(ist).strftime("%Y-%m-%d")


_last_journal_charges_mono = 0.0
_journal_live_probe: tuple[float, bool, str] = (0.0, False, "")
_last_special_journal_snap_mono = 0.0
_last_post_lock_journal_snap_mono = 0.0


def _journal_enabled_indices():
    if tracker is None:
        from universe import DESK_IDS
        return list(DESK_IDS)
    return list(tracker.settings.get("enabled_indices") or [])


async def _ledger_owner(request: Optional[Request], role: str) -> str:
    """Admin book vs guest book. Guests key off Kite user id when known."""
    if role != "guest" or request is None:
        return "admin"
    guest = await _guest_from_request(request)
    if not guest:
        return "guest:unknown"
    if guest.get("member_id"):
        return f"member:{guest['member_id']}"
    try:
        doc = await _load_user_kite_doc(guest)
    except Exception:
        doc = None
    uid = (doc or {}).get("kite_user_id") or guest.get("_id") or "unknown"
    return f"guest:{uid}"


def _spawn_ledger(coro) -> None:
    try:
        asyncio.create_task(coro)
    except Exception:
        pass


async def _persist_trade_ledger(
    owner_id: str,
    payload: Optional[Dict[str, Any]],
    kite=None,
    *,
    feed_ok: bool = True,
) -> None:
    """Upsert trade cycles from the live book. No-ops on Mongo errors."""
    # Member cycle capture is a separate opt-in; guest history stays unchanged and owner-scoped.
    if owner_id == "admin" and not _live_settings().get("trade_cycle_saving_enabled", True):
        return
    if owner_id.startswith("member:"):
        member_id = owner_id.split(":", 1)[1]
        member = await _find_one_capped(db.members if db is not None else None, {"_id": member_id})
        if not (member or {}).get("preferences", {}).get("trade_cycle_persistence_enabled", False):
            return
    if db is None or not owner_id:
        return
    now = now_ist()
    today = _ist_today_ymd()
    try:
        existing = await db.trade_cycles.find(
            {
                "owner_id": owner_id,
                "$or": [
                    {"status": {"$in": ["open", "partial"]}},
                    {"entry_date": today},
                    {"exit_date": today},
                ],
            },
        ).to_list(length=2000)
        fills = []
        if feed_ok and kite is not None:
            trades, orders = [], []
            try:
                trades = await asyncio.wait_for(asyncio.to_thread(kite.trades), timeout=6) or []
            except Exception:
                trades = []
            if not trades:
                try:
                    orders = await asyncio.wait_for(asyncio.to_thread(kite.orders), timeout=6) or []
                except Exception:
                    orders = []
            fills = ledger.collect_fills(trades if isinstance(trades, list) else [],
                                         orders if isinstance(orders, list) else [])
        upserts = ledger.reconcile_cycles(
            existing,
            (payload or {}).get("positions") or [],
            fills,
            owner_id=owner_id,
            now=now,
            feed_ok=feed_ok,
        )
        for doc in upserts:
            cid = doc.get("cycle_id")
            if not cid:
                continue
            await db.trade_cycles.update_one(
                {"cycle_id": cid},
                {"$set": {k: v for k, v in doc.items() if k != "_id"}},
                upsert=True,
            )
        if owner_id == "admin" and feed_ok and upserts:
            await _stamp_journal_from_ledger(upserts)
    except Exception:
        logging.getLogger("server").debug("trade ledger persist skipped", exc_info=True)


async def _stamp_journal_from_ledger(cycles: List[Dict[str, Any]]) -> None:
    if db is None:
        return
    day = journal.journal_session_ymd()
    doc = await db.trade_journal.find_one({"date": day}, {"legs": 1})
    if not doc:
        return
    legs = doc.get("legs") or []
    if not legs:
        return
    if ledger.stamp_journal_legs(legs, cycles):
        await db.trade_journal.update_one({"date": day}, {"$set": {"legs": legs}})


async def _kite_day_charges(kite) -> Dict[str, Any]:
    """Virtual contract-note totals for today — stored on the journal doc only."""
    from kite_charges import (
        aggregate_contract_notes,
        empty_charges_payload,
        resolve_charge_params,
    )

    orders: list = []
    trades: list = []
    try:
        orders = await asyncio.to_thread(kite.orders) or []
    except Exception:
        orders = []
    try:
        trades = await asyncio.to_thread(kite.trades) or []
    except Exception:
        trades = []
    today = _ist_today_ymd()
    params, book_stats = resolve_charge_params(orders, trades, today_ymd=today)
    if not params:
        return empty_charges_payload(order_count=0, note="No priced fills today.")
    params = params[:500]
    notes: list = []
    chunk_size = 50
    for i in range(0, len(params), chunk_size):
        chunk = params[i : i + chunk_size]
        try:
            part = await asyncio.to_thread(kite.get_virtual_contract_note, chunk)
            if isinstance(part, list):
                notes.extend(part)
            elif isinstance(part, dict) and isinstance(part.get("data"), list):
                notes.extend(part["data"])
            elif part:
                notes.append(part)
        except Exception:
            continue
    payload = aggregate_contract_notes(notes)
    payload["source"] = f"kite_virtual_contract:{book_stats.get('source') or 'trades'}"
    return payload


async def _maybe_journal_charges(*, force: bool = False) -> Optional[Dict[str, Any]]:
    global _last_journal_charges_mono
    now = time.monotonic()
    if not force and (now - _last_journal_charges_mono) < 90:
        return None
    try:
        kite = tracker.kite_service.kite if tracker and tracker.kite_service else None
        if not kite:
            return None
        payload = await _kite_day_charges(kite)
        _last_journal_charges_mono = now
        return payload
    except Exception:
        return None


async def _journal_live_session_today(day: str) -> bool:
    """True when Kite is printing fills or index last-trade on a closed calendar day.

    Used for unlisted special sessions (and as a live confirm on Muhurat).
    """
    global _journal_live_probe
    nowm = time.monotonic()
    cached_at, cached_ok, cached_day = _journal_live_probe
    if cached_day == day and (nowm - cached_at) < 90:
        return cached_ok
    kite = tracker.kite_service.kite if tracker and tracker.kite_service else None
    if not kite:
        _journal_live_probe = (nowm, False, day)
        return False
    from kite_charges import has_fills_on_date, quotes_traded_on_date

    trades: list = []
    orders: list = []
    quotes: dict = {}
    try:
        trades = await asyncio.to_thread(kite.trades) or []
    except Exception:
        trades = []
    try:
        orders = await asyncio.to_thread(kite.orders) or []
    except Exception:
        orders = []
    live = has_fills_on_date(trades, orders, today_ymd=day)
    if not live:
        try:
            quotes = await asyncio.to_thread(kite.quote, ["NSE:NIFTY 50", "BSE:SENSEX"]) or {}
        except Exception:
            quotes = {}
        live = quotes_traded_on_date(quotes, day)
    _journal_live_probe = (nowm, bool(live), day)
    return bool(live)


async def _purge_closed_session_journal_autos() -> int:
    """Drop Sat/Sun/full-holiday P&L rows created by the Positions poll. Keep user notes."""
    if db is None:
        return 0
    n = 0
    try:
        docs = await db.trade_journal.find(
            {},
            {
                "date": 1,
                "booked_pnl": 1,
                "pnl_exited": 1,
                "exited_count": 1,
                "win_trades": 1,
                "loss_trades": 1,
                "went_well": 1,
                "went_wrong": 1,
                "notes": 1,
                "tags": 1,
                "rating": 1,
                "followed_plan": 1,
                "screenshots.id": 1,
            },
        ).to_list(length=4000)
    except Exception:
        return 0
    dates = [d.get("date") for d in docs if journal.is_closed_session_auto_snapshot(d)]
    now = now_ist()
    cal = journal.ist_ymd(now)
    by_date = {str(d.get("date") or "")[:10]: d for d in docs if d.get("date")}
    today_doc = by_date.get(cal)
    if today_doc and journal.is_pre_session_auto_snapshot(today_doc, now):
        dates.append(cal)
    dates = list({x for x in dates if x})
    if not dates:
        return 0
    try:
        result = await db.trade_journal.delete_many({"date": {"$in": dates}})
        n = int(getattr(result, "deleted_count", 0) or 0)
        if n:
            logging.getLogger("server").info("Purged %s stale journal auto-snapshots", n)
        return n
    except Exception:
        return 0


async def _snapshot_trade_journal(
    payload: Dict[str, Any],
    *,
    force_lock: bool = False,
    allow_locked_update: bool = False,
    live_session: bool = False,
) -> None:
    """Upsert today's booked P&L + brokerage.

    Locked days may reconcile same-day booked P&L; open/total P&L and journal notes stay frozen.

    Weekends and full holidays do not get a new journal date unless Kite is
    actually printing (Muhurat, or any surprise session with fills/quotes).
    """
    if db is None:
        return
    now = now_ist()
    day = journal.journal_session_ymd(now)
    calendar_session = journal.iso_is_trading_day(day)
    if not calendar_session and not live_session:
        live_session = await _journal_live_session_today(day)
    if not calendar_session and not live_session:
        await _purge_closed_session_journal_autos()
        return
    if payload.get("error") and not (payload.get("positions") or payload.get("pnl_today")):
        return
    try:
        snap = journal.snapshot_from_positions(payload, date=day)
        existing = await db.trade_journal.find_one({"date": day})
        if snap.get("funds_base") and (not existing or existing.get("inferred_cashflow") is None):
            prev = await db.trade_journal.find_one(
                {"date": {"$lt": day}},
                {"date": 1, "funds_close": 1, "funds_total": 1, "funds_base": 1},
                sort=[("date", -1)],
            )
            from account_equity import infer_cashflow
            gap = infer_cashflow(prev, snap.get("funds_base"))
            if gap is not None:
                snap["inferred_cashflow"] = gap
        need_charges = existing is None or existing.get("charges_total") is None
        charges = await _maybe_journal_charges(force=force_lock or need_charges)
        if journal.charges_usable(charges):
            journal.apply_charges(snap, charges)
        fields = journal.apply_snapshot(
            existing, snap, force_lock=force_lock, now=now, live_session=live_session,
            enabled_indices=_journal_enabled_indices(), allow_locked_update=allow_locked_update,
        )
        if not fields:
            return
        ops = journal.mongo_upsert_ops(fields)
        await db.trade_journal.update_one(
            {"date": day},
            ops,
            upsert=True,
        )
    except Exception:
        logger = logging.getLogger("server")
        logger.exception("trade journal snapshot failed for %s", day)
        try:
            await record_error(
                source="journal",
                message="trade journal snapshot failed",
                traceback_text="",
                path="/journal",
                kind="JournalSnapshotError",
                extra={"date": day},
            )
        except Exception:
            pass


async def _snapshot_member_trade_journal(member_id: str, payload: Dict[str, Any]) -> None:
    """Store a member-owned P&L summary without persisting broker position legs."""
    if db is None or not member_id:
        return
    now = now_ist()
    day = journal.journal_session_ymd(now)
    if not journal.iso_is_trading_day(day):
        return
    if payload.get("error") or payload.get("token_issue"):
        return
    try:
        snap = journal.snapshot_from_positions(payload, date=day)
        existing = await db.member_journal.find_one({"user_id": member_id, "date": day})
        fields = journal.apply_snapshot(existing, snap, now=now)
        if not fields:
            return
        # Member journals retain only day-level aggregates; detailed fills and
        # position legs remain governed by the separate admin-controlled cycle opt-in.
        aggregate_keys = {
            "date", "trading_date", "pnl_total", "pnl_open", "pnl_exited",
            "booked_pnl", "exited_only_pnl", "open_count", "exited_count",
            "partial_count", "trade_count", "win_trades", "loss_trades",
            "index_pnl", "booked_index_pnl", "snapshot_at", "eod_locked",
            "eod_locked_at", "frozen_pnl", "funds_base", "funds_total",
            "funds_close", "inferred_cashflow",
        }
        summary = {key: value for key, value in fields.items() if key in aggregate_keys}
        if not summary:
            return
        await db.member_journal.update_one(
            {"user_id": member_id, "date": day},
            {"$set": summary, "$setOnInsert": {
                "user_id": member_id,
                "created_at": datetime.now(timezone.utc).isoformat(),
            }},
            upsert=True,
        )
    except Exception:
        logging.getLogger("server").exception(
            "member trade journal snapshot failed for %s", day,
        )


async def _journal_eod_lock_loop() -> None:
    """Snapshot the book in the background and reconcile same-day booked P&L after EOD."""
    global _last_special_journal_snap_mono, _last_post_lock_journal_snap_mono
    locked_for: Optional[str] = None
    log = logging.getLogger("server")
    while True:
        try:
            await asyncio.sleep(20)
            now = now_ist()
            day = journal.journal_session_ymd(now)
            calendar_session = journal.iso_is_trading_day(day)
            live = False
            if not calendar_session:
                live = await _journal_live_session_today(day)
            muhurat = is_special_session_day(now) and calendar_session
            special = muhurat or live
            t = now.time()
            start, end = session_poll_bounds(now)
            in_special_window = start <= t <= end
            enabled = _journal_enabled_indices()
            if locked_for == day:
                # Kite's day book remains available after close; stop at midnight so
                # its prior-session P&L cannot be attributed to the next journal date.
                if (
                    (calendar_session or live)
                    and journal.ist_ymd(now) == day
                    and time.monotonic() - _last_post_lock_journal_snap_mono >= 60
                ):
                    try:
                        mid = await get_positions(None, "admin")
                        await _snapshot_trade_journal(mid, allow_locked_update=True, live_session=live)
                        _last_post_lock_journal_snap_mono = time.monotonic()
                    except Exception as e:
                        log.warning("journal same-day reconciliation failed: %s", e)
                continue
            if special and (live or in_special_window or is_special_session_day(now)):
                if time.monotonic() - _last_special_journal_snap_mono >= 60:
                    try:
                        mid = await get_positions(None, "admin")
                        await _snapshot_trade_journal(mid, live_session=live)
                        _last_special_journal_snap_mono = time.monotonic()
                    except Exception as e:
                        log.warning("journal special-session snapshot failed: %s", e)

            if not journal.should_lock_eod(now, live_session=live, enabled_indices=enabled):
                if calendar_session:
                    if time.monotonic() - _last_special_journal_snap_mono >= 60:
                        try:
                            mid = await get_positions(None, "admin")
                            await _snapshot_trade_journal(mid, live_session=live)
                            _last_special_journal_snap_mono = time.monotonic()
                        except Exception as e:
                            log.warning("journal in-session snapshot failed: %s", e)
                continue
            if locked_for == day:
                continue
            if db is not None:
                existing = await db.trade_journal.find_one({"date": day}, {"eod_locked": 1})
                if existing and existing.get("eod_locked"):
                    locked_for = day
                    continue
            try:
                result = await get_positions(None, "admin")
            except Exception as e:
                log.warning("journal EOD lock: positions fetch failed: %s", e)
                continue
            await _snapshot_trade_journal(result, force_lock=True, live_session=live)
            if db is not None:
                doc = await db.trade_journal.find_one({"date": day}, {"eod_locked": 1})
                if doc and doc.get("eod_locked"):
                    locked_for = day
                    log.info("Trade journal EOD locked for %s", day)
        except asyncio.CancelledError:
            raise
        except Exception:
            log.debug("journal EOD lock loop tick failed", exc_info=True)


class JournalIn(BaseModel):
    went_well: Optional[str] = None
    went_wrong: Optional[str] = None
    notes: Optional[str] = None
    tags: Optional[List[str]] = None
    rating: Optional[int] = None
    followed_plan: Optional[bool] = None


class JournalShotIn(BaseModel):
    name: Optional[str] = None
    mime: Optional[str] = "image/jpeg"
    data: str


class TradeCycleArchiveCompactIn(BaseModel):
    from_date: str = Field(alias="from")
    to_date: str = Field(alias="to")
    sha256: str = Field(pattern=r"^[a-fA-F0-9]{64}$")


async def _journal_year_payload(y: int) -> Dict[str, Any]:
    await _purge_closed_session_journal_autos()
    start, end = f"{y:04d}-01-01", f"{y + 1:04d}-01-01"
    docs = await db.trade_journal.find(
        {"date": {"$gte": start, "$lt": end}},
        {"_id": 0, "screenshots": 0},
    ).to_list(length=400)
    days = [journal.public_day(d, include_images=False) for d in docs]
    days = [d for d in days if d and journal.include_on_journal_calendar(d)]
    return {
        "year": y,
        "today": journal.ist_ymd(),
        "heatmap": journal.year_heatmap(days, y),
        "stats": journal.month_stats(days),
    }


@api_router.get("/journal/period")
async def journal_period(
    start: str = Query(..., alias="from"),
    end: str = Query(..., alias="to"),
    index: Optional[str] = None,
    _admin: bool = Depends(require_admin),
):
    """Booked profit, charges, and win % between two IST dates (optional index)."""
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", start) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", end):
        raise HTTPException(400, "Use YYYY-MM-DD for from and to")
    if start > end:
        raise HTTPException(400, "from must be on or before to")
    try:
        a = datetime.strptime(start, "%Y-%m-%d")
        b = datetime.strptime(end, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(400, "Invalid from/to date")
    if (b - a).days > 400:
        raise HTTPException(400, "Range too long (max 400 days)")
    await _purge_closed_session_journal_autos()
    docs = await db.trade_journal.find(
        {"date": {"$gte": start, "$lte": end}},
        {"_id": 0, "screenshots": 0},
    ).to_list(length=420)
    days = [journal.public_day(d, include_images=False) for d in docs]
    days = [d for d in days if d]
    want = (index or "").strip().upper() or None
    return {
        "from": start,
        "to": end,
        "index": want or "ALL",
        "today": journal.ist_ymd(),
        "stats": journal.period_stats(days, start=start, end=end, index=want),
        "indices": list(journal.HEATMAP_INDICES),
    }


@api_router.get("/journal")
async def journal_month(
    year: Optional[int] = None,
    month: Optional[int] = None,
    view: Optional[str] = None,
    _admin: bool = Depends(require_admin),
):
    """Month calendar, or year heatmap when view=year."""
    now = now_ist()
    y = int(year or now.year)
    if y < 2020 or y > 2100:
        raise HTTPException(400, "Invalid year/month")
    if (view or "").lower() == "year":
        return await _journal_year_payload(y)
    m = int(month or now.month)
    if m < 1 or m > 12:
        raise HTTPException(400, "Invalid year/month")
    start, end = journal.month_bounds(y, m)
    await _purge_closed_session_journal_autos()
    docs = await db.trade_journal.find(
        {"date": {"$gte": start, "$lt": end}},
        {"_id": 0, "screenshots.data": 0},
    ).to_list(length=40)
    days = [journal.public_day(d, include_images=False) for d in docs]
    days = [d for d in days if d and journal.include_on_journal_calendar(d)]
    days.sort(key=lambda d: d.get("date") or "")
    return {
        "year": y,
        "month": m,
        "today": journal.ist_ymd(),
        "days": days,
        "stats": journal.month_stats(days),
        "tags": journal.DEFAULT_TAGS,
    }


@api_router.get("/journal/year/{year}")
async def journal_year(year: int, _admin: bool = Depends(require_admin)):
    """Year consolidation: month nets + NIFTY / SENSEX / BANKNIFTY heatmap."""
    y = int(year)
    if y < 2020 or y > 2100:
        raise HTTPException(400, "Invalid year")
    return await _journal_year_payload(y)


@api_router.get("/journal/{day}")
async def journal_day(day: str, _admin: bool = Depends(require_admin)):
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", day):
        raise HTTPException(400, "Use YYYY-MM-DD")
    await _purge_closed_session_journal_autos()
    session_day = journal.journal_session_ymd()
    if day == session_day:
        try:
            mid = await get_positions(None, "admin")
            await _snapshot_trade_journal(mid, allow_locked_update=True)
        except Exception:
            logging.getLogger("server").debug("journal day snapshot skipped", exc_info=True)
    doc = await db.trade_journal.find_one({"date": day}, {"_id": 0})
    if not doc:
        return {"date": day, "empty": True, "tags": journal.DEFAULT_TAGS}
    if day == session_day and doc.get("charges_total") is None:
        charges = await _maybe_journal_charges(force=True)
        if journal.charges_usable(charges):
            journal.apply_charges(doc, charges)
            await db.trade_journal.update_one(
                {"date": day},
                {"$set": {
                    "brokerage": doc.get("brokerage"),
                    "charges_total": doc.get("charges_total"),
                    "charges_source": doc.get("charges_source"),
                    "booked_after_charges": doc.get("booked_after_charges"),
                }},
            )
    out = journal.public_day(doc, include_images=True)
    out["empty"] = False
    out["tags_catalog"] = journal.DEFAULT_TAGS
    return out


@api_router.put("/journal/{day}")
async def journal_save(day: str, payload: JournalIn, _admin: bool = Depends(require_admin)):
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", day):
        raise HTTPException(400, "Use YYYY-MM-DD")
    fields = journal.sanitize_journal_fields(payload.model_dump())
    await db.trade_journal.update_one(
        {"date": day},
        {"$set": {**fields, "date": day}, "$setOnInsert": {
            "pnl_total": 0,
            "pnl_open": 0,
            "pnl_exited": 0,
            "open_count": 0,
            "exited_count": 0,
            "trade_count": 0,
            "win_trades": 0,
            "loss_trades": 0,
            "legs": [],
            "screenshots": [],
        }},
        upsert=True,
    )
    doc = await db.trade_journal.find_one({"date": day}, {"_id": 0})
    return journal.public_day(doc, include_images=False)


@api_router.post("/journal/{day}/screenshot")
async def journal_add_shot(day: str, payload: JournalShotIn, _admin: bool = Depends(require_admin)):
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", day):
        raise HTTPException(400, "Use YYYY-MM-DD")
    try:
        shot = journal.decode_screenshot(payload.model_dump())
    except ValueError as e:
        raise HTTPException(400, str(e))
    doc = await db.trade_journal.find_one({"date": day}, {"screenshots": 1})
    existing = (doc or {}).get("screenshots") or []
    if len(existing) >= journal.MAX_SCREENSHOTS:
        raise HTTPException(400, f"Max {journal.MAX_SCREENSHOTS} screenshots per day")
    await db.trade_journal.update_one(
        {"date": day},
        {"$set": {"date": day}, "$push": {"screenshots": shot}, "$setOnInsert": {
            "pnl_total": 0, "legs": [], "went_well": "", "went_wrong": "", "notes": "", "tags": [],
        }},
        upsert=True,
    )
    return {"id": shot["id"], "name": shot["name"], "mime": shot["mime"]}


@api_router.delete("/journal/{day}/screenshot/{shot_id}")
async def journal_del_shot(day: str, shot_id: str, _admin: bool = Depends(require_admin)):
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", day):
        raise HTTPException(400, "Use YYYY-MM-DD")
    await db.trade_journal.update_one({"date": day}, {"$pull": {"screenshots": {"id": shot_id}}})
    return {"deleted": shot_id}


@api_router.get("/trades")
async def list_trades(
    request: Request,
    _admin: bool = Depends(require_admin),
    from_date: str = Query(..., alias="from"),
    to_date: str = Query(..., alias="to"),
    index: Optional[str] = None,
    status: Optional[str] = None,
):
    """Readable trade tape for the journal (same cycles as Excel)."""
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", from_date) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", to_date):
        raise HTTPException(400, "from and to must be YYYY-MM-DD")
    if from_date > to_date:
        raise HTTPException(400, "from must be on or before to")
    if db is None:
        raise HTTPException(503, "Database unavailable")
    owner_id = await _ledger_owner(request, "admin")
    query = {
        "owner_id": owner_id,
        "$or": [
            {"entry_date": {"$gte": from_date, "$lte": to_date}},
            {"exit_date": {"$gte": from_date, "$lte": to_date}},
            {"entry_date": {"$lte": to_date}, "status": {"$in": ["open", "partial"]}},
            {"entry_date": {"$lte": to_date}, "exit_date": {"$gte": from_date}},
            {"entry_date": {"$lte": to_date}, "exit_date": None},
        ],
    }
    try:
        docs = await db.trade_cycles.find(
            query,
            {"_id": 0, "events": 0, "fills": 0},
        ).to_list(length=4000)
    except Exception:
        docs = []
    cycles = ledger.filter_cycles(docs, start=from_date, end=to_date, index=index, status=status)
    trades = [ledger.compact_trade(c) for c in cycles]
    return {
        "from": from_date,
        "to": to_date,
        "index": (index or "ALL"),
        "count": len(trades),
        "trades": trades,
        "memory": ledger.summarize_trade_memory(cycles),
    }


@api_router.get("/trades/export")
async def export_trades(
    request: Request,
    _admin: bool = Depends(require_admin),
    from_date: str = Query(..., alias="from"),
    to_date: str = Query(..., alias="to"),
    index: Optional[str] = None,
    status: Optional[str] = None,
):
    """Excel of stored trade cycles (entry + exit clocks) — admin journal only."""
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", from_date) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", to_date):
        raise HTTPException(400, "from and to must be YYYY-MM-DD")
    if from_date > to_date:
        raise HTTPException(400, "from must be on or before to")
    if db is None:
        raise HTTPException(503, "Database unavailable")
    owner_id = await _ledger_owner(request, "admin")
    query = {
        "owner_id": owner_id,
        "$or": [
            {"entry_date": {"$gte": from_date, "$lte": to_date}},
            {"exit_date": {"$gte": from_date, "$lte": to_date}},
            {"entry_date": {"$lte": to_date}, "status": {"$in": ["open", "partial"]}},
            {"entry_date": {"$lte": to_date}, "exit_date": {"$gte": from_date}},
            {"entry_date": {"$lte": to_date}, "exit_date": None},
        ],
    }
    docs = await db.trade_cycles.find(query, {"_id": 0}).to_list(length=8000)
    cycles = ledger.filter_cycles(docs, start=from_date, end=to_date, index=index, status=status)
    data = ledger.workbook_bytes(cycles, start=from_date, end=to_date)
    fname = f"striklenz-trades-{from_date}-to-{to_date}.xlsx"
    return Response(
        content=data,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": f'attachment; filename="{fname}"',
            "Cache-Control": "no-store",
        },
    )


CYCLE_ARCHIVE_SPOOL_MEMORY_BYTES = 8 * 1024 * 1024
CYCLE_ARCHIVE_DELETE_BATCH_SIZE = 500


def _trade_cycle_archive_date_bounds(from_date: str, to_date: str) -> tuple[str, str]:
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", from_date or ""):
        raise HTTPException(400, "from must be a valid YYYY-MM-DD date")
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", to_date or ""):
        raise HTTPException(400, "to must be a valid YYYY-MM-DD date")
    try:
        start = date.fromisoformat(from_date)
        end = date.fromisoformat(to_date)
    except ValueError as exc:
        raise HTTPException(400, "from and to must be valid calendar dates") from exc
    if start > end:
        raise HTTPException(400, "from must be on or before to")
    if end > now_ist().date():
        raise HTTPException(400, "to cannot be in the future")
    # ISO date strings sort lexically, so Mongo's inclusive bounds match the selected calendar dates.
    return start.isoformat(), end.isoformat()


def _trade_cycle_archive_query(owner_id: str, start: str, end: str) -> dict:
    return {
        "owner_id": owner_id,
        "status": "closed",
        "exit_date": {"$gte": start, "$lte": end},
    }


def _trade_cycle_archive_details_query(owner_id: str, start: str, end: str) -> dict:
    return {
        **_trade_cycle_archive_query(owner_id, start, end),
        "$or": [
            {"events": {"$exists": True, "$ne": []}},
            {"fills": {"$exists": True, "$ne": []}},
        ],
    }


async def _trade_cycle_archive_lines(query: dict):
    cursor = db.trade_cycles.find(query).sort("_id", 1)
    async for doc in cursor:
        yield (json_util.dumps(doc, sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8")


async def _stream_spooled_archive(archive):
    try:
        archive.seek(0)
        while True:
            chunk = archive.read(1024 * 1024)
            if not chunk:
                break
            yield chunk
    finally:
        archive.close()


@api_router.get("/trades/archive/range")
async def trade_cycle_archive_range(
    request: Request,
    from_date: str = Query(..., alias="from"),
    to_date: str = Query(..., alias="to"),
    _admin: bool = Depends(require_admin),
):
    """Count this admin's closed cycles and fill details in the selected date range."""
    if db is None:
        raise HTTPException(503, "Database unavailable")
    start, end = _trade_cycle_archive_date_bounds(from_date, to_date)
    owner_id = await _ledger_owner(request, "admin")
    query = _trade_cycle_archive_query(owner_id, start, end)
    try:
        count = await db.trade_cycles.count_documents(query)
        detail_count = await db.trade_cycles.count_documents(
            _trade_cycle_archive_details_query(owner_id, start, end)
        )
    except Exception as exc:
        logging.getLogger("server").exception("Could not count trade-cycle archive range")
        raise HTTPException(503, "Could not load archive range") from exc
    return {
        "from": start,
        "to": end,
        "count": count,
        "detail_count": detail_count,
    }


@api_router.get("/trades/archive/export")
async def export_trade_cycle_archive(
    request: Request,
    from_date: str = Query(..., alias="from"),
    to_date: str = Query(..., alias="to"),
    _admin: bool = Depends(require_admin),
):
    """Download all closed-cycle documents in the selected inclusive range as gzip NDJSON."""
    if db is None:
        raise HTTPException(503, "Database unavailable")
    start, end = _trade_cycle_archive_date_bounds(from_date, to_date)
    owner_id = await _ledger_owner(request, "admin")
    query = _trade_cycle_archive_query(owner_id, start, end)
    archive = tempfile.SpooledTemporaryFile(max_size=CYCLE_ARCHIVE_SPOOL_MEMORY_BYTES, mode="w+b")
    digest = hashlib.sha256()
    count = 0
    try:
        with gzip.GzipFile(fileobj=archive, mode="wb", mtime=0) as compressed:
            async for line in _trade_cycle_archive_lines(query):
                compressed.write(line)
                digest.update(line)
                count += 1
    except Exception as exc:
        archive.close()
        logging.getLogger("server").exception("Could not prepare trade-cycle archive for %s to %s", start, end)
        raise HTTPException(503, "Could not prepare the trade-cycle archive") from exc
    if not count:
        archive.close()
        raise HTTPException(404, "No closed cycles exist in the selected date range")
    filename = f"striklenz-cycle-archive-{start}-to-{end}.jsonl.gz"
    return StreamingResponse(
        _stream_spooled_archive(archive),
        media_type="application/gzip",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "no-store",
            "X-Archive-SHA256": digest.hexdigest(),
            "X-Archive-Cycle-Count": str(count),
        },
    )


@api_router.post("/trades/archive/compact")
async def compact_trade_cycle_archive(
    payload: TradeCycleArchiveCompactIn,
    request: Request,
    _admin: bool = Depends(require_admin),
):
    """Remove fill details only after the exact selected range matches its download."""
    if db is None:
        raise HTTPException(503, "Database unavailable")
    start, end = _trade_cycle_archive_date_bounds(payload.from_date, payload.to_date)
    owner_id = await _ledger_owner(request, "admin")
    query = _trade_cycle_archive_query(owner_id, start, end)
    digest = hashlib.sha256()
    count = 0
    detail_count = 0
    try:
        async for line in _trade_cycle_archive_lines(query):
            digest.update(line)
            count += 1
        detail_count = await db.trade_cycles.count_documents(
            _trade_cycle_archive_details_query(owner_id, start, end)
        )
    except Exception as exc:
        logging.getLogger("server").exception("Could not verify trade-cycle archive for %s to %s", start, end)
        raise HTTPException(503, "Could not verify the archive against current trade details") from exc
    if not count:
        raise HTTPException(409, "No eligible closed cycles remain; refresh the archive list")
    if not detail_count:
        raise HTTPException(409, "No raw cycle details remain to compact")
    if not hmac.compare_digest(payload.sha256.lower(), digest.hexdigest()):
        raise HTTPException(409, "Trade details changed after download; download a fresh archive before compacting")
    try:
        result = await db.trade_cycles.update_many(
            _trade_cycle_archive_details_query(owner_id, start, end),
            {"$unset": {"events": "", "fills": ""}},
        )
    except Exception as exc:
        logging.getLogger("server").exception("Could not compact trade-cycle details for %s to %s", start, end)
        raise HTTPException(503, "Archive verified, but cycle details could not be compacted") from exc
    compacted = int(getattr(result, "modified_count", 0) or 0)
    return {
        "from": start,
        "to": end,
        "archive_count": count,
        "compacted_count": compacted,
        "detail_count": detail_count,
        "remaining_count": max(0, detail_count - compacted),
        "sha256": digest.hexdigest(),
    }


@api_router.post("/trades/archive/delete")
async def delete_trade_cycle_archive(
    payload: TradeCycleArchiveCompactIn,
    request: Request,
    _admin: bool = Depends(require_admin),
):
    """Delete closed cycles only after the exact selected range matches its download."""
    if db is None:
        raise HTTPException(503, "Database unavailable")
    start, end = _trade_cycle_archive_date_bounds(payload.from_date, payload.to_date)
    owner_id = await _ledger_owner(request, "admin")
    query = _trade_cycle_archive_query(owner_id, start, end)
    digest = hashlib.sha256()
    count = 0
    cycle_ids = []
    try:
        cursor = db.trade_cycles.find(query).sort("_id", 1)
        async for doc in cursor:
            line = (json_util.dumps(doc, sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8")
            digest.update(line)
            cycle_ids.append(doc["_id"])
            count += 1
    except Exception as exc:
        logging.getLogger("server").exception("Could not verify trade-cycle archive before delete for %s to %s", start, end)
        raise HTTPException(503, "Could not verify the archive against current trade details") from exc
    if not count:
        raise HTTPException(409, "No eligible closed cycles remain; refresh the archive list")
    if not hmac.compare_digest(payload.sha256.lower(), digest.hexdigest()):
        raise HTTPException(409, "Trade details changed after download; download a fresh archive before deleting")
    try:
        deleted = 0
        for offset in range(0, len(cycle_ids), CYCLE_ARCHIVE_DELETE_BATCH_SIZE):
            # Chunk ids to keep Mongo commands bounded while avoiding one round trip per cycle.
            result = await db.trade_cycles.delete_many({
                "_id": {"$in": cycle_ids[offset:offset + CYCLE_ARCHIVE_DELETE_BATCH_SIZE]},
                "owner_id": owner_id,
                "status": "closed",
                "exit_date": {"$gte": start, "$lte": end},
            })
            deleted += int(getattr(result, "deleted_count", 0) or 0)
    except Exception as exc:
        logging.getLogger("server").exception("Could not delete archived trade cycles for %s to %s", start, end)
        raise HTTPException(503, f"Archive verified, but deletion was incomplete for {start} to {end}") from exc
    return {
        "from": start,
        "to": end,
        "archive_count": count,
        "deleted_count": deleted,
        "remaining_count": max(0, count - deleted),
        "sha256": digest.hexdigest(),
    }


@api_router.get("/positions/brokerage-day")
async def get_brokerage_day(request: Request, role: str = Depends(require_desk_user)):
    """Day's brokerage via Kite virtual contract note (read-only).

    Prefers kite.trades() fills (reliable prices) then COMPLETE orders.
    Never returns API keys, secrets, or access tokens. Admin-only.
    """
    from kite_charges import (
        aggregate_contract_notes,
        empty_charges_payload,
        resolve_charge_params,
    )

    kite = None
    if role == "guest":
        guest = await _guest_from_request(request)
        kite, st = await _user_kite_client(guest)
        if not kite:
            return {
                "ok": False,
                "brokerage": None,
                "charges_total": None,
                "order_count": 0,
                "error": "Connect your broker to load charges.",
                "connect_required": True,
                "user_kite": st,
            }
    elif tracker.mode != "kite" or not tracker.kite_service:
        if not tracker.kite_service or getattr(tracker, "offline_sticky", False):
            return {
                "ok": False,
                "brokerage": None,
                "charges_total": None,
                "order_count": 0,
                "error": "Broker not connected." if not tracker.kite_service else "Broker is offline.",
            }
        kite = tracker.kite_service.kite
    else:
        kite = tracker.kite_service.kite
    try:
        if kite is None:
            kite = tracker.kite_service.kite
    except Exception as e:
        err = f"Kite client: {type(e).__name__}: {e}"
        err = _sanitize_public_error(err) or "Data feed temporarily unavailable"
        return {
            "ok": False,
            "brokerage": None,
            "charges_total": None,
            "order_count": 0,
            "error": err,
        }

    orders = []
    trades = []
    orders_err = None
    trades_err = None
    try:
        orders = await asyncio.to_thread(kite.orders) or []
    except Exception as e:
        orders_err = f"{type(e).__name__}: {e}"
        logger.warning("kite.orders for charges failed: %s", orders_err)
    try:
        trades = await asyncio.to_thread(kite.trades) or []
    except Exception as e:
        trades_err = f"{type(e).__name__}: {e}"
        logger.warning("kite.trades for charges failed: %s", trades_err)

    if orders_err and trades_err:
        err = _sanitize_public_error(f"Kite orders/trades: {orders_err}") or "Data feed temporarily unavailable"
        return {
            "ok": False,
            "brokerage": None,
            "charges_total": None,
            "order_count": 0,
            "error": err,
        }

    today = _ist_today_ymd()
    params, book_stats = resolve_charge_params(orders, trades, today_ymd=today)
    book_stats["orders_fetched"] = len(orders) if isinstance(orders, list) else 0
    book_stats["trades_fetched"] = len(trades) if isinstance(trades, list) else 0
    book_stats["as_of"] = today

    if not params:
        payload = empty_charges_payload(
            order_count=0,
            note=(
                "No priced fills in kite.trades()/orders() for today — "
                "charges appear after executions clear on the exchange."
            ),
        )
        payload["book"] = book_stats
        payload["skipped_zero_price"] = book_stats.get("skipped_zero_price", 0)
        if orders_err:
            payload["orders_warning"] = orders_err
        if trades_err:
            payload["trades_warning"] = trades_err
        return payload

    # Cap + chunk — one bad row / oversized batch must not blank the chip.
    params = params[:500]
    notes: list = []
    chunk_errors: list[str] = []
    chunk_size = 50
    for i in range(0, len(params), chunk_size):
        chunk = params[i : i + chunk_size]
        try:
            part = await asyncio.to_thread(kite.get_virtual_contract_note, chunk)
            if isinstance(part, list):
                notes.extend(part)
            elif isinstance(part, dict) and isinstance(part.get("data"), list):
                notes.extend(part["data"])
            elif part:
                notes.append(part)
        except Exception as e:
            msg = f"{type(e).__name__}: {e}"
            logger.warning("get_virtual_contract_note chunk %s failed: %s", i // chunk_size, msg)
            chunk_errors.append(msg)

    if not notes and chunk_errors:
        err = _sanitize_public_error(f"Charges API: {chunk_errors[0]}") or "Data feed temporarily unavailable"
        return {
            "ok": False,
            "brokerage": None,
            "charges_total": None,
            "order_count": len(params),
            "book": book_stats,
            "error": err,
        }

    payload = aggregate_contract_notes(notes)
    payload.update({
        "order_count": len(params),
        "source": f"kite_virtual_contract:{book_stats.get('source') or 'trades'}",
        "book": book_stats,
        "skipped_zero_price": book_stats.get("skipped_zero_price", 0),
    })
    if chunk_errors:
        payload["warning"] = f"{len(chunk_errors)} charge chunk(s) failed; totals may be partial."
    return payload


# ------------------- CAS Rule Expiry (paper / live) -------------------
class CasSettingsIn(BaseModel):
    lots: Optional[int] = None
    ce_otm_steps: Optional[int] = None
    pe_otm_steps: Optional[int] = None
    product: Optional[str] = None
    live_trading: Optional[bool] = None
    paper_any_day: Optional[bool] = None
    debug_mode: Optional[bool] = None
    watch_indexes: Optional[List[str]] = None
    auto_trade_enabled: Optional[bool] = None
    auto_trade_mode: Optional[str] = None
    auto_trade_lots: Optional[int] = None
    auto_prepare_time: Optional[str] = None
    auto_arm_time: Optional[str] = None
    auto_signal_start: Optional[str] = None
    auto_cutoff_time: Optional[str] = None
    auto_bullish_pts: Optional[float] = None
    auto_bearish_pts: Optional[float] = None
    auto_poll_ms: Optional[int] = None


class CasAutoTradeInjectIn(BaseModel):
    indicative: float


class CasActivateIn(BaseModel):
    confirm_live: bool = False


class CasBacktestIn(BaseModel):
    start: Optional[str] = None
    end: Optional[str] = None
    lots: Optional[int] = None
    capital: Optional[float] = None
    indexes: Optional[List[str]] = None


async def _persist_cas_auto_log() -> None:
    """Keep Paper DRY-BUY / NO_TRADE rows in Mongo so a test session is reviewable."""
    if db is None:
        return
    try:
        from cas_auto_trade import get_auto_trade
        rows = get_auto_trade().drain_persists()
    except Exception:
        return
    for rec in rows:
        doc = dict(rec)
        doc["saved_at"] = datetime.now(timezone.utc).isoformat()
        try:
            await db.cas_auto_log.update_one(
                {
                    "day": doc.get("day"),
                    "at": doc.get("at"),
                    "kind": doc.get("kind"),
                    "order_id": doc.get("order_id"),
                },
                {"$set": doc},
                upsert=True,
            )
        except Exception:
            logger.debug("cas auto log persist skipped", exc_info=True)


async def require_cas_desk_user(request: Request):
    """Allow admin/guest CAS use while keeping this protected desk out of member plans."""
    if await _is_admin_request(request):
        return "admin"
    if await _member_session_from_request(request):
        raise HTTPException(403, "CAS is not available to member accounts")
    if await _guest_from_request(request):
        return "guest"
    raise HTTPException(401, "Sign in required")


@api_router.get("/cas/status")
async def cas_status(role: str = Depends(require_cas_desk_user)):
    """CAS desk status — admin + guest (read-only for guests); never member accounts."""
    import cas_bridge

    try:
        status = await asyncio.to_thread(cas_bridge.get_status, tracker)
    except Exception as e:
        logger.warning("cas status failed: %s", e, exc_info=True)
        raise HTTPException(500, "CAS status unavailable")
    await _persist_cas_auto_log()
    await _persist_cas_auto_log()
    # Broker readiness diagnostics remain Admin-only; sanitize guest-facing errors.
    if role == "guest":
        plain = status.get("plain") or {}
        if plain.get("last_error"):
            plain = {**plain, "last_error": _sanitize_public_error(plain.get("last_error"))}
        plain = {
            key: value
            for key, value in plain.items()
            if key not in {"live_ready_code", "live_ready_summary"}
        }
        state = status.get("state") or {}
        status = {
            "plain": plain,
            "day": status.get("day"),
            "settings": {
                "lots": (status.get("settings") or {}).get("lots"),
                "live_trading": (status.get("settings") or {}).get("live_trading"),
                "debug_mode": (status.get("settings") or {}).get("debug_mode"),
                "watch_indexes": (status.get("settings") or {}).get("watch_indexes"),
                "auto_trade_enabled": (status.get("settings") or {}).get("auto_trade_enabled"),
                "auto_trade_mode": (status.get("settings") or {}).get("auto_trade_mode"),
                "auto_trade_lots": (status.get("settings") or {}).get("auto_trade_lots"),
                "auto_bullish_pts": (status.get("settings") or {}).get("auto_bullish_pts"),
                "auto_bearish_pts": (status.get("settings") or {}).get("auto_bearish_pts"),
            },
            "auto_trade": status.get("auto_trade") or {},
            "config": {
                "lots": (status.get("config") or {}).get("lots"),
                "live_trading": (status.get("config") or {}).get("live_trading"),
                "debug_mode": (status.get("config") or {}).get("debug_mode"),
                "watch_indexes": (status.get("config") or {}).get("watch_indexes"),
                "product": (status.get("config") or {}).get("product"),
                "watch_start": (status.get("config") or {}).get("watch_start"),
                "watch_end": (status.get("config") or {}).get("watch_end"),
                "move_window_start": (status.get("config") or {}).get("move_window_start"),
                "move_window_end": (status.get("config") or {}).get("move_window_end"),
            },
            "state": {
                "activated": state.get("activated"),
                "fired_indexes": state.get("fired_indexes"),
                "fills": state.get("fills") or [],
                "timings": state.get("timings") or [],
                "last_ltp": state.get("last_ltp") or {},
                "baseline_close": state.get("baseline_close") or {},
                "last_index_move_at": state.get("last_index_move_at") or {},
                "last_close": state.get("last_close") or {},
                "ws_connected": state.get("ws_connected"),
                "ticks_seen": state.get("ticks_seen"),
            },
            "ws": status.get("ws") or {},
            "market_closed": status.get("market_closed"),
            "role": "guest",
        }
    else:
        status = {**status, "role": "admin"}
    return status


@api_router.post("/cas/settings")
async def cas_settings(payload: CasSettingsIn, _admin: bool = Depends(require_admin)):
    """Update CAS lots / paper-live — admin only."""
    import cas_bridge

    patch = {k: v for k, v in payload.model_dump().items() if v is not None}
    try:
        return await asyncio.to_thread(
            cas_bridge.update_settings, patch, tracker, allow_live=True
        )
    except PermissionError as e:
        raise HTTPException(403, str(e))
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        logger.warning("cas settings failed: %s", e, exc_info=True)
        raise HTTPException(500, "Could not update CAS settings")


@api_router.post("/cas/activate")
async def cas_activate(payload: CasActivateIn = CasActivateIn(), _admin: bool = Depends(require_admin)):
    """Arm the CAS window. Live mode requires confirm_live=true."""
    import cas_bridge

    try:
        return await asyncio.to_thread(
            cas_bridge.activate,
            tracker,
            by="admin",
            # Always pass the client's confirm flag; activate() re-checks live after sync.
            require_live_confirm=bool(payload.confirm_live),
        )
    except RuntimeError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        logger.warning("cas activate failed: %s", e, exc_info=True)
        raise HTTPException(500, "Could not activate CAS")


@api_router.post("/cas/deactivate")
async def cas_deactivate(_admin: bool = Depends(require_admin)):
    import cas_bridge

    try:
        return await asyncio.to_thread(cas_bridge.deactivate, tracker, by="admin")
    except Exception as e:
        logger.warning("cas deactivate failed: %s", e, exc_info=True)
        raise HTTPException(500, "Could not deactivate CAS")


@api_router.post("/cas/reset")
async def cas_reset(_admin: bool = Depends(require_admin)):
    import cas_bridge

    try:
        return await asyncio.to_thread(cas_bridge.reset_day, tracker)
    except Exception as e:
        logger.warning("cas reset failed: %s", e, exc_info=True)
        raise HTTPException(500, "Could not reset CAS day state")


@api_router.post("/cas/auto-trade/inject")
async def cas_auto_trade_inject(
    payload: CasAutoTradeInjectIn, _admin: bool = Depends(require_admin)
):
    """Paper/debug only: treat a number as the first NSE indicative print."""
    import cas_bridge

    try:
        return await asyncio.to_thread(
            cas_bridge.inject_auto_trade, float(payload.indicative), tracker
        )
    except RuntimeError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        logger.warning("cas auto-trade inject failed: %s", e, exc_info=True)
        raise HTTPException(500, "Could not inject auto-trade print")


@api_router.post("/cas/backtest")
async def cas_backtest(payload: CasBacktestIn, role: str = Depends(require_cas_desk_user)):
    """Run CAS expiry-day backtest for admins/guests, never member accounts."""
    import cas_bridge

    try:
        result = await asyncio.to_thread(
            cas_bridge.run_backtest,
            tracker,
            start=payload.start,
            end=payload.end,
            lots=payload.lots,
            capital=payload.capital,
            indexes=payload.indexes,
        )
        return {"ok": True, "role": role, "result": result}
    except Exception as e:
        logger.warning("cas backtest failed: %s", e, exc_info=True)
        raise HTTPException(500, f"Backtest failed: {type(e).__name__}")


# ================================================================
# Index Event Risk Dashboard endpoints (admin upload + read APIs)
# ================================================================

_UPLOAD_TYPE_TO_INDEX = {
    "nifty50": "NIFTY",
    "banknifty": "BANKNIFTY",
    "sensex": "SENSEX",
}

_ACTIVE_INDEX_ALIASES = {
    "NIFTY": "NIFTY",
    "NIFTY50": "NIFTY",
    "NIFTY_50": "NIFTY",
    "SENSEX": "SENSEX",
    "BANK": "BANKNIFTY",
    "BANKNIFTY": "BANKNIFTY",
    "BANK_NIFTY": "BANKNIFTY",
}


@api_router.post("/admin/upload/constituents")
async def upload_constituents(
    upload_type: str = Form(...),
    file: UploadFile = File(...),
    _admin: bool = Depends(require_admin),
):
    """Admin-only. upload_type ∈ {'nifty50','banknifty','sensex'}."""
    key = (upload_type or "").strip().lower().replace("-", "").replace(" ", "")
    idx_code = _UPLOAD_TYPE_TO_INDEX.get(key)
    if not idx_code:
        raise HTTPException(400, f"Unknown upload_type '{upload_type}'. Expected one of {list(_UPLOAD_TYPE_TO_INDEX)}")
    try:
        raw = await file.read()
    except Exception as e:
        raise HTTPException(400, f"Could not read uploaded file: {e}")
    if not raw:
        raise HTTPException(400, "Uploaded file is empty.")
    try:
        df = ers.read_upload_bytes(raw, file.filename or "")
    except ValueError as e:
        raise HTTPException(400, str(e))
    rows, errors = ers.parse_constituents(df, idx_code)
    if errors:
        return {
            "ok": False,
            "index": idx_code,
            "errors": errors,
            "row_count": 0,
        }
    res = await ers.save_constituents(
        db, idx_code, rows, source_filename=file.filename or ""
    )
    return {
        "ok": True,
        "index": idx_code,
        "rows_saved": res["rows_saved"],
        "filename": file.filename,
        "uploaded_at": res.get("uploaded_at"),
    }


@api_router.post("/admin/upload/events")
async def upload_events(
    file: UploadFile = File(...),
    _admin: bool = Depends(require_admin),
):
    """Admin-only manual replacement for the NSE event calendar (CSV or XLSX)."""
    try:
        raw = await file.read()
    except Exception as e:
        raise HTTPException(400, f"Could not read uploaded file: {e}")
    if not raw:
        raise HTTPException(400, "Uploaded file is empty.")
    try:
        df = ers.read_upload_bytes(raw, file.filename or "")
    except ValueError as e:
        raise HTTPException(400, str(e))
    rows, errors = ers.parse_events(df)
    if errors:
        return {"ok": False, "errors": errors, "row_count": 0}
    res = await ers.save_events(db, rows, source_filename=file.filename or "")
    return {
        "ok": True,
        "rows_saved": res["rows_saved"],
        "filename": file.filename,
        "uploaded_at": res.get("uploaded_at"),
    }


@api_router.post("/admin/upload/events/refresh")
async def refresh_events_from_nse(_admin: bool = Depends(require_admin)):
    """Admin-only immediate refresh from NSE's three-month CSV export."""
    import httpx

    try:
        result = await ers.refresh_nse_event_calendar(db)
    except ValueError as e:
        logger.warning("NSE event calendar CSV validation failed: %s", e)
        raise HTTPException(502, "NSE event data could not be validated; saved events were kept.")
    except httpx.HTTPError as e:
        logger.warning("NSE event calendar download failed: %s", e)
        raise HTTPException(502, "Could not refresh events from NSE; saved events were kept.") from e
    return {
        "ok": True,
        "rows_saved": result["rows_saved"],
        "uploaded_at": result["uploaded_at"],
        "source_filename": "NSE Download: Equity events (Next 3 Months)",
    }


@api_router.post("/admin/upload/holidays")
async def upload_holidays(
    file: UploadFile = File(...),
    _admin: bool = Depends(require_admin),
):
    """Admin-only. NSE cash/F&O holiday circular (CSV or XLSX). Replaces those years."""
    import holiday_calendar as hcal
    try:
        raw = await file.read()
    except Exception as e:
        raise HTTPException(400, f"Could not read uploaded file: {e}")
    if not raw:
        raise HTTPException(400, "Uploaded file is empty.")
    try:
        df = ers.read_upload_bytes(raw, file.filename or "")
    except ValueError as e:
        raise HTTPException(400, str(e))
    rows, errors = hcal.parse_holidays(df)
    if errors:
        return {"ok": False, "errors": errors, "row_count": 0}
    res = await hcal.save_holidays(db, rows, source_filename=file.filename or "")
    return {
        "ok": True,
        "rows_saved": res["rows_saved"],
        "filename": file.filename,
        "uploaded_at": res.get("uploaded_at"),
    }


@api_router.get("/holidays")
async def get_holidays(request: Request):
    """NSE holiday circular: uploaded rows when present, else empty (UI uses built-in)."""
    import holiday_calendar as hcal
    payload = await hcal.fetch_holidays_payload(db)
    if await _is_admin_request(request):
        return payload
    return {key: value for key, value in payload.items() if key not in {"source", "source_filename"}}


@api_router.get("/upload/meta")
async def get_upload_meta(_admin: bool = Depends(require_admin)):
    """Last-upload stamps and freshness advisories for the Admin Upload UI."""
    return await ers.fetch_upload_meta(db)


@api_router.post("/admin/upload/reuse/{upload_type}")
async def reuse_existing_upload(
    upload_type: str,
    _admin: bool = Depends(require_admin),
):
    """Admin confirms that one category's existing uploaded data remains current."""
    key = (upload_type or "").strip().lower().replace("-", "").replace(" ", "")
    try:
        return await ers.confirm_existing_upload(db, key)
    except KeyError as exc:
        raise HTTPException(400, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc


@api_router.get("/events/{index}")
async def get_index_events(index: str, request: Request):
    """
    Return the joined event list for the given index. Only events whose
    company is a current constituent of that index are returned.
    """
    key = (index or "").strip().upper()
    idx_code = _ACTIVE_INDEX_ALIASES.get(key)
    if not idx_code:
        raise HTTPException(400, f"Unknown index '{index}'")
    events, coverage = await ers.fetch_events_for_index(db, idx_code)
    meta = await ers.fetch_upload_meta(db)
    events_meta = meta.get("events") or {}
    idx_key = {"NIFTY": "nifty50", "BANKNIFTY": "banknifty", "SENSEX": "sensex"}.get(idx_code)
    constituents_meta = meta.get(idx_key) or {} if idx_key else {}
    # Coverage diagnostics can identify unmatched names, so expose them only to Admin.
    is_admin = await _is_admin_request(request)
    return {
        "index": idx_code,
        "count": len(events),
        "events": events,
        "events_uploaded_at": events_meta.get("uploaded_at"),
        "constituents_uploaded_at": constituents_meta.get("uploaded_at"),
        "join": coverage if is_admin else None,
        **(
            {
                "events_source_filename": events_meta.get("source_filename"),
                "constituents_source_filename": constituents_meta.get("source_filename"),
            }
            if is_admin
            else {}
        ),
    }


@api_router.get("/constituents/{index}")
async def get_index_constituents(index: str, request: Request):
    key = (index or "").strip().upper()
    idx_code = _ACTIVE_INDEX_ALIASES.get(key)
    if not idx_code:
        raise HTTPException(400, f"Unknown index '{index}'")
    docs = await db.index_constituents.find(
        {"index": idx_code}, {"_id": 0}
    ).sort("weightage", -1).to_list(length=500)
    meta = await ers.fetch_upload_meta(db)
    idx_key = {"NIFTY": "nifty50", "BANKNIFTY": "banknifty", "SENSEX": "sensex"}.get(idx_code)
    cmeta = meta.get(idx_key) or {} if idx_key else {}
    payload = {
        "index": idx_code,
        "count": len(docs),
        "constituents": docs,
        "uploaded_at": cmeta.get("uploaded_at"),
    }
    if await _is_admin_request(request):
        payload["source_filename"] = cmeta.get("source_filename")
    return payload


class DeskGuideIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    why: List[str] = Field(default_factory=list)
    whyNot: List[str] = Field(default_factory=list)
    results: List[Any] = Field(default_factory=list)
    holidays: List[Any] = Field(default_factory=list)
    book: Optional[Dict[str, Any]] = None
    vix: Optional[float] = None
    vix_quote: Optional[Dict[str, Any]] = None
    giftPct: Optional[float] = None
    gift_quote: Optional[Dict[str, Any]] = None
    weekday: Optional[int] = None
    band: Optional[str] = None
    surface: Optional[str] = None
    adjust: Optional[Dict[str, Any]] = None
    fii: Optional[Dict[str, Any]] = None
    oi: Optional[List[Any]] = None
    outside: Optional[Dict[str, Any]] = None
    journal: Optional[Dict[str, Any]] = None
    memory: Optional[Dict[str, Any]] = None
    market_memory: Optional[Dict[str, Any]] = None
    sells: Optional[List[Any]] = None
    index: Optional[str] = None
    session_focus: Optional[str] = None
    force: Optional[bool] = False
    skip_llm: Optional[bool] = False


class DeskAiToggleIn(BaseModel):
    desk_ai_show: Optional[bool] = None
    desk_ai_radar: Optional[bool] = None
    desk_ai_positions: Optional[bool] = None
    desk_ai_carry: Optional[bool] = None


@api_router.post("/desk-ai")
async def update_desk_ai(
    payload: DeskAiToggleIn,
    request: Request,
    role: str = Depends(require_desk_user),
):
    """Desk-wide on/off plus per-surface ticks. Radar stays admin-only."""
    if await _member_session_from_request(request):
        await _member_context(request, "desk_ai")
    dump = payload.model_dump()
    patch = {}
    if dump.get("desk_ai_show") is not None:
        show = bool(dump["desk_ai_show"])
        patch["desk_ai_show"] = show
        patch["desk_ai_ask"] = True
    if dump.get("desk_ai_carry") is not None:
        patch["desk_ai_carry"] = bool(dump["desk_ai_carry"])
    if role == "admin":
        if dump.get("desk_ai_radar") is not None:
            patch["desk_ai_radar"] = bool(dump["desk_ai_radar"])
        if dump.get("desk_ai_positions") is not None:
            patch["desk_ai_positions"] = bool(dump["desk_ai_positions"])
    if not patch:
        raise HTTPException(400, "Nothing to update")
    await tracker.save_settings(patch)
    return resolve_desk_ai(tracker.settings)


@api_router.get("/desk-outside")
async def get_desk_outside(
    index: Optional[str] = Query(None),
    request: Request = None,
    role: str = Depends(require_desk_user),
):
    """Heavyweight cash movers + news. MCX tape only when that name is selected."""
    if request and await _member_session_from_request(request):
        await _member_context(request, "desk_ai")
    payload = await desk_outside_svc.snapshot(db, tracker, index=index)
    if role != "admin":
        import market_intel

        payload = market_intel.remove_public_source_metadata(payload)
        if isinstance(payload.get("briefing"), str):
            payload["briefing"] = re.sub(
                r"\b(?:kite|zerodha|yahoo|twelve[\s_-]*data|fmp)\b",
                "market data",
                payload["briefing"],
                flags=re.IGNORECASE,
            )
    return payload


@api_router.get("/desk-guide")
async def get_desk_guide(request: Request, role: str = Depends(require_desk_user)):
    """LLM availability for the carry-brief copilot. No Kite secrets."""
    if await _member_session_from_request(request):
        await _member_context(request, "desk_ai")
    return desk_guide_svc.status()


@api_router.post("/desk-guide")
async def post_desk_guide(
    body: DeskGuideIn,
    request: Request,
    role: str = Depends(require_desk_user),
):
    """Coach over outside tape (movers/news) plus clipped book. Optional GPT."""
    if await _member_session_from_request(request):
        await _member_context(request, "desk_ai")
    # This response includes explicit trade actions; non-admin surfaces use market data only.
    if role != "admin":
        raise HTTPException(403, "Trade guidance is available to Admin only")
    payload = body.model_dump()
    flags = resolve_desk_ai(tracker.settings if tracker else {})
    surface = str(payload.get("surface") or "").lower()
    if surface in ("desk-panel", "desk_panel"):
        surface = "desk"
        payload["surface"] = "desk"
    if not flags.get("desk_ai_show", False):
        payload["skip_llm"] = True
    elif not flags.get("desk_ai_ask", True):
        payload["skip_llm"] = True
    if surface == "carry" and not flags.get("desk_ai_carry", False):
        payload["skip_llm"] = True
    try:
        outside = await desk_outside_svc.snapshot(db, tracker, index=payload.get("index"))
        if surface == "carry":
            payload["outside"] = desk_guide_svc.carry_outside(outside)
        else:
            payload["outside"] = outside
    except Exception as exc:
        logger.warning("desk-guide outside evidence unavailable: %s", type(exc).__name__)
        payload["outside"] = {"available": False}
    cache_scope = await _ledger_owner(request, role)
    return await desk_guide_svc.maybe_guide(
        payload,
        cache_scope=cache_scope,
        allow_force=role == "admin",
    )


@api_router.get("/desk-memory")
async def desk_memory(
    request: Request,
    days: int = 60,
    role: str = Depends(require_desk_user),
):
    """Owner-scoped, aggregate-only strategy memory; never return individual cycles."""
    if db is None:
        raise HTTPException(503, "Database unavailable")
    owner = await _ledger_owner(request, role)
    days = max(7, min(int(days or 60), 180))
    end = now_ist().strftime("%Y-%m-%d")
    start = (now_ist() - timedelta(days=days)).strftime("%Y-%m-%d")
    query = {
        "owner_id": owner,
        "status": "closed",
        "$or": [
            {"entry_date": {"$gte": start, "$lte": end}},
            {"exit_date": {"$gte": start, "$lte": end}},
        ],
    }
    try:
        docs = await db.trade_cycles.find(
            query,
            {"_id": 0, "events": 0, "fills": 0},
        ).to_list(length=2000)
    except Exception as exc:
        logger.exception("desk-memory query failed")
        raise HTTPException(503, "Trade memory unavailable") from exc
    cycles = ledger.filter_cycles(docs, start=start, end=end, status="closed")
    return ledger.summarize_trade_memory(cycles)


# ------------------- Lifecycle -------------------
import market_intel_api
market_intel_api.mount(
    api_router,
    require_admin=require_admin,
    require_desk_user=require_desk_user,
    require_member_feature=require_member_feature,
)
import adr_api
adr_api.mount(api_router, require_admin=require_admin, require_desk_user=require_desk_user)
import global_markets_api
global_markets_api.mount(
    api_router,
    require_desk_user=require_desk_user,
    require_admin=require_admin,
    require_member_feature=require_member_feature,
)
import market_memory_api
market_memory_api.mount(api_router, require_desk_user=require_desk_user)
# ---------------------------------------------------------------------------
# Striklenz platform layer: public site-config, admin integrations (Google OAuth
# + Razorpay + broker registry), and Google sign-in (config-driven, admin-managed).
# All secrets are encrypted at rest and NEVER returned to the client.
# ---------------------------------------------------------------------------
PLATFORM_CONFIG_ID = "striklenz_platform"
PUBLIC_ENTRY_AUTH_TIMEOUT_DEFAULT_SECONDS = 10
PUBLIC_ENTRY_AUTH_TIMEOUT_MIN_SECONDS = 5
PUBLIC_ENTRY_AUTH_TIMEOUT_MAX_SECONDS = 60

DEFAULT_BROKERS = [
    {"id": "zerodha", "name": "Broker", "enabled": True, "auth_type": "oauth",
     "capabilities": ["positions", "holdings", "orders", "funds", "pnl", "fno", "oauth"], "note": "Live"},
    {"id": "upstox", "name": "Upstox", "enabled": False, "auth_type": "oauth",
     "capabilities": ["positions", "holdings", "orders", "funds", "pnl", "fno", "oauth"], "note": "Coming soon"},
    {"id": "angelone", "name": "Angel One", "enabled": False, "auth_type": "oauth",
     "capabilities": ["positions", "holdings", "orders", "funds", "pnl", "fno", "oauth"], "note": "Coming soon"},
    {"id": "dhan", "name": "Dhan", "enabled": False, "auth_type": "oauth",
     "capabilities": ["positions", "holdings", "orders", "funds", "pnl", "fno"], "note": "Coming soon"},
    {"id": "groww", "name": "Groww", "enabled": False, "auth_type": "oauth",
     "capabilities": ["positions", "holdings", "orders", "pnl", "fno"], "note": "Coming soon"},
    {"id": "fyers", "name": "Fyers", "enabled": False, "auth_type": "oauth",
     "capabilities": ["positions", "holdings", "orders", "funds", "pnl", "fno", "oauth"], "note": "Coming soon"},
    {"id": "5paisa", "name": "5paisa", "enabled": False, "auth_type": "oauth",
     "capabilities": ["positions", "holdings", "orders", "pnl", "fno"], "note": "Coming soon"},
    {"id": "icicidirect", "name": "ICICI Direct", "enabled": False, "auth_type": "oauth",
     "capabilities": ["positions", "holdings", "orders", "funds", "pnl", "fno"], "note": "Coming soon"},
    {"id": "kotak", "name": "Kotak Neo", "enabled": False, "auth_type": "oauth",
     "capabilities": ["positions", "holdings", "orders", "funds", "pnl", "fno"], "note": "Coming soon"},
    {"id": "aliceblue", "name": "Alice Blue", "enabled": False, "auth_type": "oauth",
     "capabilities": ["positions", "holdings", "orders", "pnl", "fno"], "note": "Coming soon"},
    {"id": "motilaloswal", "name": "Motilal Oswal", "enabled": False, "auth_type": "oauth",
     "capabilities": ["positions", "holdings", "orders", "pnl", "fno"], "note": "Coming soon"},
    {"id": "iifl", "name": "IIFL Securities", "enabled": False, "auth_type": "oauth",
     "capabilities": ["positions", "holdings", "orders", "pnl", "fno"], "note": "Coming soon"},
]

LANDING_PAGE_SECTIONS = {
    "navigation": True,
    "hero": True,
    "ticker": True,
    "features": True,
    "product_demo": True,
    "pro_showcase": True,
    "broker_connect": False,
    "pricing": True,
    "faq": True,
    "bottom_cta": True,
    "footer": True,
}
LANDING_PAGE_FEATURE_CARDS = (
    "option_chain",
    "strike_pressure",
    "global_markets",
    "straddle",
    "market_events",
    "desk_ai",
)

# Keep public landing copy on a known-key allowlist so Admin settings cannot
# leak arbitrary config fields into the anonymous site-config response.
LANDING_PAGE_COPY_KEYS = {
    "nav_product", "nav_features", "nav_premium", "nav_pricing", "nav_faq",
    "nav_demo", "nav_login", "nav_start",
    "hero_eyebrow", "hero_title", "hero_description", "hero_start",
    "hero_demo", "hero_compare", "hero_no_broker",
    "features_title", "features_description",
    "product_eyebrow", "product_title", "product_description",
    "film_eyebrow", "film_title", "film_description",
    "pro_eyebrow", "pro_title", "pro_description", "pro_oi_label", "pro_oi_description",
    "pro_market_intel_label", "pro_journal_label", "pro_positions_label",
    "broker_eyebrow", "broker_title", "broker_description",
    "pricing_title", "pricing_description", "pricing_indicative",
    "plan_normal_title", "plan_normal_description",
    "plan_normal_intro", "plan_normal_note",
    "plan_premium_title", "plan_premium_description",
    "plan_premium_intro", "plan_premium_note",
    "plan_pro_title", "plan_pro_description", "pricing_footer",
    "plan_pro_intro", "plan_pro_note",
    "faq_title", "cta_title", "cta_description", "cta_button",
    "footer_disclaimer",
    *(f"card_{card}_{suffix}" for card in LANDING_PAGE_FEATURE_CARDS for suffix in ("title", "description")),
    *(f"faq_{index}_{field}" for index in range(3) for field in ("question", "answer")),
    "faq_data_question", "faq_data_answer",
    "faq_signin_question", "faq_signin_answer",
}

_LANDING_PLAN_IDS = ("normal", "premium", "pro")
_LANDING_PLAN_SCREENSHOT_LIMIT = 3
_LANDING_PLAN_SCREENSHOT_MAX_BYTES = 600 * 1024


def _normalize_landing_plan_screenshots(raw: object = None, *, strict: bool = False) -> dict:
    raw = raw if isinstance(raw, dict) else {}
    result = {plan_id: [] for plan_id in _LANDING_PLAN_IDS}
    for plan_id in _LANDING_PLAN_IDS:
        entries = raw.get(plan_id, [])
        if not isinstance(entries, list):
            if strict:
                raise ValueError("Plan screenshots must be provided as a list")
            continue
        if len(entries) > _LANDING_PLAN_SCREENSHOT_LIMIT:
            if strict:
                raise ValueError(f"Upload no more than {_LANDING_PLAN_SCREENSHOT_LIMIT} screenshots per plan")
            entries = entries[:_LANDING_PLAN_SCREENSHOT_LIMIT]
        for entry in entries:
            try:
                if not isinstance(entry, dict):
                    raise ValueError("Screenshot must be an image")
                image_data = entry.get("data_url")
                match = re.fullmatch(
                    r"data:image/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})",
                    image_data if isinstance(image_data, str) else "",
                )
                if not match:
                    raise ValueError("Use a PNG, JPEG, or WebP image")
                if len(match.group(2)) > ((_LANDING_PLAN_SCREENSHOT_MAX_BYTES + 2) // 3) * 4:
                    raise ValueError("Each screenshot must be 600 KB or smaller")
                image_bytes = base64.b64decode(match.group(2), validate=True)
                if len(image_bytes) > _LANDING_PLAN_SCREENSHOT_MAX_BYTES:
                    raise ValueError("Each screenshot must be 600 KB or smaller")
                mime_type = f"image/{match.group(1)}"
                valid_signature = (
                    (mime_type == "image/png" and image_bytes.startswith(b"\x89PNG\r\n\x1a\n"))
                    or (mime_type == "image/jpeg" and image_bytes.startswith(b"\xff\xd8\xff"))
                    or (
                        mime_type == "image/webp"
                        and len(image_bytes) >= 12
                        and image_bytes[:4] == b"RIFF"
                        and image_bytes[8:12] == b"WEBP"
                    )
                )
                if not valid_signature:
                    raise ValueError("Image content does not match its file type")
                screenshot_id = entry.get("id")
                if not isinstance(screenshot_id, str) or not screenshot_id.strip():
                    raise ValueError("Screenshot is missing its identifier")
                title = entry.get("title")
                result[plan_id].append({
                    "id": screenshot_id.strip()[:80],
                    "title": title.strip()[:120] if isinstance(title, str) and title.strip() else "Plan screenshot",
                    "mime_type": mime_type,
                    "data_url": image_data,
                })
            except (ValueError, binascii.Error) as exc:
                if strict:
                    raise ValueError(str(exc)) from exc
    return result


_LANDING_PLAN_FEATURE_ID = re.compile(r"^[a-z0-9_]{1,80}$")
_LANDING_PREVIEW_PRIVATE_KEYS = {
    "access_token",
    "api_key",
    "api_secret",
    "credentials",
    "journal",
    "member_id",
    "password",
    "positions",
    "request_token",
    "trade_cycles",
    "trade_journal",
    "trades",
    "user_id",
}
_LANDING_PREVIEW_MAX_BYTES = 3 * 1024 * 1024


def _contains_landing_preview_private_data(value: object) -> bool:
    if isinstance(value, dict):
        return any(
            str(key).lower() in _LANDING_PREVIEW_PRIVATE_KEYS
            or _contains_landing_preview_private_data(child)
            for key, child in value.items()
        )
    if isinstance(value, list):
        return any(_contains_landing_preview_private_data(child) for child in value)
    return False


def _normalize_landing_plan_preview_snapshot(raw: object) -> Optional[dict]:
    if raw is None:
        return None
    if not isinstance(raw, dict):
        raise ValueError("Plan preview capture must be an object")
    if _contains_landing_preview_private_data(raw):
        raise ValueError("Plan preview captures cannot contain member positions, journal, trades, or credentials")
    if set(raw) - {"captured_at", "indices", "market_intel", "global_markets", "desk_market", "activity", "holidays"}:
        raise ValueError("Plan preview capture contains an unsupported data section")
    captured_at = raw.get("captured_at")
    if not isinstance(captured_at, str) or len(captured_at) > 40:
        raise ValueError("Plan preview capture requires a valid capture timestamp")
    try:
        datetime.fromisoformat(captured_at.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError("Plan preview capture requires a valid capture timestamp") from exc
    snapshot = dict(raw)
    if isinstance(snapshot.get("market_intel"), dict):
        import market_intel

        snapshot["market_intel"] = market_intel.remove_public_source_metadata(
            snapshot["market_intel"]
        )
    encoded_size = len(json.dumps(snapshot, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))
    if encoded_size > _LANDING_PREVIEW_MAX_BYTES:
        raise ValueError("Plan preview capture is larger than 3 MB")
    return snapshot


def _normalize_landing_page_config(
    raw: object = None,
    *,
    include_screenshot_data: bool = True,
    include_plan_preview_data: bool = True,
) -> dict:
    """Keep marketing visibility independent from broker access and member entitlements."""
    raw = raw if isinstance(raw, dict) else {}
    raw_sections = raw.get("sections")
    raw_sections = raw_sections if isinstance(raw_sections, dict) else {}
    sections = {
        key: raw_sections.get(key, default) is True
        for key, default in LANDING_PAGE_SECTIONS.items()
    }

    raw_cards = raw.get("feature_cards")
    if isinstance(raw_cards, list):
        cards = {
            "global_markets" if value == "market_structure" else value
            for value in raw_cards
            if isinstance(value, str)
        }
        if "oi_distribution" in cards:
            cards.remove("oi_distribution")
            cards.update(("straddle", "market_events"))
    else:
        cards = set(LANDING_PAGE_FEATURE_CARDS)
    raw_brokers = raw.get("broker_ids")
    known_brokers = {broker["id"] for broker in DEFAULT_BROKERS}
    broker_ids = (
        {value for value in raw_brokers if isinstance(value, str)}
        if isinstance(raw_brokers, list)
        else known_brokers
    )
    screenshots = _normalize_landing_plan_screenshots(raw.get("plan_screenshots"))
    if not include_screenshot_data:
        screenshots = {
            plan_id: [
                {key: shot[key] for key in ("id", "title", "mime_type")}
                for shot in entries
            ]
            for plan_id, entries in screenshots.items()
        }
    raw_walkthrough_features = raw.get("plan_walkthrough_features")
    walkthrough_features = {}
    if isinstance(raw_walkthrough_features, dict):
        for plan_id in _LANDING_PLAN_IDS:
            values = raw_walkthrough_features.get(plan_id)
            if not isinstance(values, list):
                continue
            seen = set()
            walkthrough_features[plan_id] = [
                value for value in values
                if isinstance(value, str)
                and _LANDING_PLAN_FEATURE_ID.fullmatch(value)
                and not (value in seen or seen.add(value))
            ]
    raw_walkthrough_copy = raw.get("plan_walkthrough_copy")
    walkthrough_copy = {}
    if isinstance(raw_walkthrough_copy, dict):
        for feature_id, copy in raw_walkthrough_copy.items():
            if not (
                isinstance(feature_id, str)
                and _LANDING_PLAN_FEATURE_ID.fullmatch(feature_id)
                and isinstance(copy, dict)
            ):
                continue
            normalized_copy = {
                key: value.strip()[:600]
                for key, value in copy.items()
                if key in {"description", "edge"}
                and isinstance(value, str)
                and value.strip()
            }
            if normalized_copy:
                walkthrough_copy[feature_id] = normalized_copy
    raw_copy = raw.get("copy")
    landing_copy = {
        key: value.strip()[:800]
        for key, value in raw_copy.items()
        if key in LANDING_PAGE_COPY_KEYS
        and isinstance(value, str)
        and value.strip()
    } if isinstance(raw_copy, dict) else {}
    config = {
        "sections": sections,
        "plan_more_info_enabled": raw.get("plan_more_info_enabled", True) is True,
        "feature_cards": [
            feature_id for feature_id in LANDING_PAGE_FEATURE_CARDS
            if feature_id in cards
        ],
        "broker_ids": [
            broker["id"] for broker in DEFAULT_BROKERS
            if broker["id"] in broker_ids
        ],
        "plan_screenshots": screenshots,
        "plan_walkthrough_features": walkthrough_features,
        "plan_walkthrough_copy": walkthrough_copy,
        "copy": landing_copy,
    }
    if include_plan_preview_data:
        config["plan_demo_snapshot"] = _normalize_landing_plan_preview_snapshot(
            raw.get("plan_demo_snapshot")
        )
    return config


DEFAULT_PRICING = {
    "currency": "INR",
    "free": {"price": 0, "label": "Free"},
    "premium": {
        "monthly": 999,
        "quarterly": 2499,
        "yearly": 7999,
        "label": "Premium",
        "billing_default": "monthly",
        "offer_prices": {"monthly": "", "quarterly": "", "yearly": ""},
        "razorpay_plan_ids": {"monthly": "", "quarterly": "", "yearly": ""},
        "razorpay_offer_ids": {"monthly": "", "quarterly": "", "yearly": ""},
    },
    "pro": {
        "monthly": 0,
        "quarterly": 0,
        "yearly": 0,
        "label": "Pro",
        "billing_default": "monthly",
        "offer_prices": {"monthly": "", "quarterly": "", "yearly": ""},
        "razorpay_plan_ids": {"monthly": "", "quarterly": "", "yearly": ""},
        "razorpay_offer_ids": {"monthly": "", "quarterly": "", "yearly": ""},
    },
}


def _platform_membership(doc: dict) -> dict:
    from membership import normalize_membership
    return normalize_membership((doc or {}).get("membership"))


def _mask_secret(val: Optional[str]) -> Optional[str]:
    if not val:
        return None
    return "set"


async def _load_platform_config() -> dict:
    if db is None:
        return {}
    try:
        return await _find_one_capped(db.settings, {"_id": PLATFORM_CONFIG_ID}) or {}
    except Exception:
        return {}


def _platform_pricing(doc: dict) -> dict:
    pricing = dict(DEFAULT_PRICING)
    stored = (doc or {}).get("pricing") or {}
    if isinstance(stored, dict):
        merged = {k: (dict(v) if isinstance(v, dict) else v) for k, v in DEFAULT_PRICING.items()}
        for k, v in stored.items():
            if isinstance(v, dict) and isinstance(merged.get(k), dict):
                merged[k].update(v)
            else:
                merged[k] = v
        pricing = merged
    return pricing


def _configured_offer_price(plan: dict, cadence: str) -> Optional[float]:
    raw = (plan.get("offer_prices") or {}).get(cadence)
    if raw is None or (isinstance(raw, str) and not raw.strip()):
        return None
    if isinstance(raw, bool):
        raise ValueError("Offer prices must be positive amounts below the regular price")
    try:
        amount = float(raw)
        regular_amount = float(plan.get(cadence) or 0)
    except (TypeError, ValueError) as exc:
        raise ValueError("Offer prices must be valid amounts below the regular price") from exc
    if (
        not math.isfinite(amount)
        or not math.isfinite(regular_amount)
        or amount <= 0
        or amount >= regular_amount
        or abs(amount * 100 - round(amount * 100)) > 1e-7
    ):
        raise ValueError("Offer prices must be positive amounts below the regular price")
    return round(amount, 2)


def _normalize_pricing_offer_prices(pricing: dict) -> dict:
    normalized = dict(pricing)
    for plan_name in ("premium", "pro"):
        source = pricing.get(plan_name)
        if not isinstance(source, dict) or "offer_prices" not in source:
            continue
        plan = dict(source)
        raw_prices = source.get("offer_prices")
        if not isinstance(raw_prices, dict):
            raise HTTPException(400, "Offer prices must be configured by billing cadence")
        offer_prices = {}
        for cadence in ("monthly", "quarterly", "yearly"):
            try:
                offer_price = _configured_offer_price(
                    {**plan, "offer_prices": raw_prices},
                    cadence,
                )
            except ValueError as exc:
                raise HTTPException(400, str(exc)) from exc
            offer_prices[cadence] = "" if offer_price is None else offer_price
        plan["offer_prices"] = offer_prices
        normalized[plan_name] = plan
    return normalized


def _public_pricing(doc: dict) -> dict:
    pricing = _platform_pricing(doc)
    public = {"currency": pricing.get("currency") or "INR"}
    for name in ("free", "premium", "pro"):
        plan = pricing.get(name) or {}
        public[name] = {
            key: plan.get(key)
            for key in ("price", "monthly", "quarterly", "yearly", "label", "billing_default")
            if key in plan
        }
        if name in ("premium", "pro"):
            offer_prices = {}
            for cadence in ("monthly", "quarterly", "yearly"):
                try:
                    offer_price = _configured_offer_price(plan, cadence)
                except ValueError:
                    continue
                if offer_price is not None:
                    offer_prices[cadence] = offer_price
            public[name]["offer_prices"] = offer_prices
    return public


def _billing_readiness(doc: dict, membership: dict) -> dict:
    razorpay = (doc or {}).get("razorpay") or {}
    credentials_ready = bool(
        razorpay.get("enabled")
        and razorpay.get("key_id_enc")
        and razorpay.get("key_secret_enc")
        and razorpay.get("webhook_secret_enc")
    )
    pricing = _platform_pricing(doc)
    plans_ready = True
    offers_ready = True
    cadence_names = ("monthly", "quarterly", "yearly")
    early = membership.get("early_access") or {}
    discount_enabled = bool(early.get("enabled") and int(early.get("discount_percent") or 0) > 0)
    for plan_name in ("premium", "pro"):
        if not membership["plans"][plan_name]["enabled"]:
            continue
        plan = pricing.get(plan_name) or {}
        ids = plan.get("razorpay_plan_ids") or {}
        for cadence in cadence_names:
            try:
                amount = float(plan.get(cadence) or 0)
            except (TypeError, ValueError):
                amount = 0
            if amount <= 0 or not str(ids.get(cadence) or "").strip():
                plans_ready = False
            raw_offer_price = (plan.get("offer_prices") or {}).get(cadence)
            try:
                offer_price = _configured_offer_price(plan, cadence)
            except ValueError:
                offers_ready = False
                offer_price = None
            if (
                (discount_enabled or offer_price is not None or bool(str(raw_offer_price or "").strip()))
                and not str(
                (plan.get("razorpay_offer_ids") or {}).get(cadence) or ""
                ).strip()
            ):
                offers_ready = False
    return {
        "credentials_ready": credentials_ready,
        "plan_ids_and_prices_ready": plans_ready,
        "offer_ids_ready": offers_ready,
        "ready": credentials_ready and plans_ready and offers_ready,
    }


def _broker_overrides(doc: dict) -> dict:
    raw = (doc or {}).get("brokers")
    if isinstance(raw, dict):
        return {k: v for k, v in raw.items() if isinstance(v, dict)}
    if isinstance(raw, list):
        return {b.get("id"): b for b in raw if isinstance(b, dict) and b.get("id")}
    return {}


def _platform_brokers(doc: dict) -> list:
    overrides = _broker_overrides(doc)
    out = []
    for base in DEFAULT_BROKERS:
        b = dict(base)
        ov = overrides.get(b["id"])
        if ov and "enabled" in ov:
            b["enabled"] = bool(ov["enabled"])
        out.append(b)
    return out


def _admin_brokers(doc: dict) -> list:
    overrides = _broker_overrides(doc)
    out = []
    for base in DEFAULT_BROKERS:
        b = dict(base)
        ov = overrides.get(b["id"]) or {}
        if "enabled" in ov:
            b["enabled"] = bool(ov["enabled"])
        b["client_id"] = _decrypt_safe(ov.get("client_id_enc"))
        b["client_secret"] = _mask_secret(ov.get("client_secret_enc"))
        b["redirect_uri"] = ov.get("redirect_uri") or ""
        out.append(b)
    return out


def _decrypt_safe(enc: Optional[str]) -> Optional[str]:
    if not enc:
        return None
    try:
        return _fernet().decrypt(enc.encode()).decode()
    except Exception:
        return None


def _public_entry_auth_timeout_seconds(doc: Optional[dict]) -> int:
    value = (doc or {}).get("public_entry_auth_timeout_seconds")
    if isinstance(value, bool) or not isinstance(value, int):
        return PUBLIC_ENTRY_AUTH_TIMEOUT_DEFAULT_SECONDS
    return min(
        PUBLIC_ENTRY_AUTH_TIMEOUT_MAX_SECONDS,
        max(PUBLIC_ENTRY_AUTH_TIMEOUT_MIN_SECONDS, value),
    )


@api_router.get("/public/boot-config")
async def public_boot_config():
    """Expose the single non-sensitive preference needed to time the public auth request."""
    doc = await _load_platform_config()
    return {
        "public_entry_auth_timeout_seconds": _public_entry_auth_timeout_seconds(doc),
    }


@api_router.get("/public/site-config")
async def public_site_config():
    """Public marketing config — pricing, feature flags, broker registry. No secrets."""
    doc = await _load_platform_config()
    google = (doc or {}).get("google") or {}
    membership = _platform_membership(doc)
    google_enabled = bool(
        google.get("enabled")
        and google.get("client_id_enc")
        and google.get("client_secret_enc")
    )
    billing = _billing_readiness(doc, membership)
    public_membership = {
        "experience_enabled": membership["experience_enabled"],
        "signup_enabled": membership["signup_enabled"],
        "paid_subscriptions_enabled": bool(
            membership["paid_subscriptions_enabled"] and billing["ready"]
        ),
        "plans": membership["plans"],
        "early_access": membership["early_access"],
    }
    return {
        "app_name": APP_NAME,
        "pricing": _public_pricing(doc),
        "membership": public_membership,
        "features": {
            "google_login_enabled": google_enabled,
            "razorpay_enabled": billing["ready"],
        },
        "brokers": _platform_brokers(doc),
        "landing_page": _normalize_landing_page_config(
            (doc or {}).get("landing_page"),
            include_screenshot_data=False,
            include_plan_preview_data=False,
        ),
    }


@api_router.get("/public/landing-plan-screenshots/{plan_id}")
async def public_landing_plan_screenshots(plan_id: str):
    if plan_id not in _LANDING_PLAN_IDS:
        raise HTTPException(404, "Unknown plan")
    doc = await _load_platform_config()
    landing = _normalize_landing_page_config(
        (doc or {}).get("landing_page"),
        include_plan_preview_data=False,
    )
    if not landing["plan_more_info_enabled"]:
        raise HTTPException(404, "Plan details are unavailable")
    # Image payloads are fetched only when a visitor opens one plan's details.
    return {"plan": plan_id, "screenshots": landing["plan_screenshots"][plan_id]}


@api_router.get("/public/landing-plan-preview/{plan_id}")
async def public_landing_plan_preview(plan_id: str):
    if plan_id not in _LANDING_PLAN_IDS:
        raise HTTPException(404, "Unknown plan")
    doc = await _load_platform_config()
    membership = _platform_membership(doc)
    landing = _normalize_landing_page_config(
        (doc or {}).get("landing_page"),
        include_screenshot_data=False,
    )
    if not landing["plan_more_info_enabled"]:
        raise HTTPException(404, "Plan details are unavailable")
    entitlement_features = membership["plans"][plan_id]["features"]
    configured_features = landing["plan_walkthrough_features"]
    selected_features = configured_features.get(plan_id, entitlement_features)
    features = [feature_id for feature_id in selected_features if feature_id in entitlement_features]
    return {
        "plan": plan_id,
        "features": features,
        "copy": {
            feature_id: landing["plan_walkthrough_copy"][feature_id]
            for feature_id in features
            if feature_id in landing["plan_walkthrough_copy"]
        },
        "snapshot": landing["plan_demo_snapshot"],
    }


@api_router.post("/admin/platform/landing-plan-preview")
async def admin_landing_plan_preview_set(
    payload: dict,
    _admin: bool = Depends(require_admin),
):
    if db is None:
        raise HTTPException(503, "DB unavailable")
    try:
        snapshot = _normalize_landing_plan_preview_snapshot(payload.get("snapshot"))
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    if snapshot is None:
        raise HTTPException(400, "Plan preview capture is required")
    await db.settings.update_one(
        {"_id": PLATFORM_CONFIG_ID},
        {"$set": {"landing_page.plan_demo_snapshot": snapshot}},
        upsert=True,
    )
    return {"snapshot": snapshot}


@api_router.get("/admin/platform/config")
async def admin_platform_config_get(_admin: bool = Depends(require_admin)):
    doc = await _load_platform_config()
    google = (doc or {}).get("google") or {}
    razorpay = (doc or {}).get("razorpay") or {}
    return {
        "pricing": _platform_pricing(doc),
        "membership": _platform_membership(doc),
        "sitewalkthrough_enabled": await _get_sitewalkthrough_enabled(),
        "billing_readiness": _billing_readiness(doc, _platform_membership(doc)),
        "public_landing_enabled": bool((doc or {}).get("public_landing_enabled", False)),
        "guest_login_enabled": (doc or {}).get("guest_login_enabled") is True,
        "public_entry_auth_timeout_seconds": _public_entry_auth_timeout_seconds(doc),
        "landing_page": _normalize_landing_page_config((doc or {}).get("landing_page")),
        "brokers": _admin_brokers(doc),
        "google": {
            "enabled": bool(google.get("enabled")),
            "client_id": _decrypt_safe(google.get("client_id_enc")),
            "client_secret": _mask_secret(google.get("client_secret_enc")),
            "redirect_uri": google.get("redirect_uri") or "",
        },
        "razorpay": {
            "enabled": bool(razorpay.get("enabled")),
            "key_id": _decrypt_safe(razorpay.get("key_id_enc")),
            "key_secret": _mask_secret(razorpay.get("key_secret_enc")),
            "webhook_secret": _mask_secret(razorpay.get("webhook_secret_enc")),
        },
    }


@api_router.post("/admin/platform/config")
async def admin_platform_config_set(payload: dict, _admin: bool = Depends(require_admin)):
    if db is None:
        raise HTTPException(503, "DB unavailable")
    doc = await _load_platform_config()
    update: dict = {}

    if isinstance(payload.get("pricing"), dict):
        update["pricing"] = _normalize_pricing_offer_prices(payload["pricing"])
    if isinstance(payload.get("membership"), dict):
        from membership import normalize_membership
        update["membership"] = normalize_membership(payload["membership"])
    if "public_landing_enabled" in payload:
        update["public_landing_enabled"] = bool(payload["public_landing_enabled"])
    if "guest_login_enabled" in payload:
        update["guest_login_enabled"] = payload["guest_login_enabled"] is True
    if "public_entry_auth_timeout_seconds" in payload:
        timeout_seconds = payload["public_entry_auth_timeout_seconds"]
        if (
            isinstance(timeout_seconds, bool)
            or not isinstance(timeout_seconds, int)
            or not PUBLIC_ENTRY_AUTH_TIMEOUT_MIN_SECONDS
            <= timeout_seconds
            <= PUBLIC_ENTRY_AUTH_TIMEOUT_MAX_SECONDS
        ):
            raise HTTPException(
                400,
                "Public entry timeout must be an integer from 5 to 60 seconds",
            )
        update["public_entry_auth_timeout_seconds"] = timeout_seconds
    if isinstance(payload.get("landing_page"), dict):
        landing_config = dict(payload["landing_page"])
        stored_landing = (doc or {}).get("landing_page") or {}
        for key in (
            "plan_screenshots",
            "plan_walkthrough_features",
            "plan_walkthrough_copy",
            "plan_demo_snapshot",
            "copy",
            "plan_more_info_enabled",
        ):
            if key not in landing_config:
                landing_config[key] = stored_landing.get(
                    key,
                    True if key == "plan_more_info_enabled" else None,
                )
        try:
            _normalize_landing_plan_screenshots(
                landing_config.get("plan_screenshots"),
                strict=True,
            )
            _normalize_landing_plan_preview_snapshot(
                landing_config.get("plan_demo_snapshot")
            )
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
        update["landing_page"] = _normalize_landing_page_config(landing_config)

    if isinstance(payload.get("brokers"), list):
        bstore = dict(_broker_overrides(doc))
        for b in payload["brokers"]:
            if not (isinstance(b, dict) and b.get("id")):
                continue
            bid = b["id"]
            cur = dict(bstore.get(bid) or {})
            if "enabled" in b:
                cur["enabled"] = bool(b["enabled"])
            if "client_id" in b:
                cur["client_id_enc"] = _fernet().encrypt(str(b["client_id"]).encode()).decode() if b.get("client_id") else None
            if b.get("client_secret") and b.get("client_secret") != "set":
                cur["client_secret_enc"] = _fernet().encrypt(str(b["client_secret"]).encode()).decode()
            if "redirect_uri" in b:
                cur["redirect_uri"] = str(b.get("redirect_uri") or "")
            bstore[bid] = cur
        update["brokers"] = bstore

    if isinstance(payload.get("google"), dict):
        g = payload["google"]
        gcfg = dict((doc or {}).get("google") or {})
        if "enabled" in g:
            gcfg["enabled"] = bool(g["enabled"])
        if g.get("client_id"):
            gcfg["client_id_enc"] = _fernet().encrypt(str(g["client_id"]).encode()).decode()
        if g.get("client_secret") and g.get("client_secret") != "set":
            gcfg["client_secret_enc"] = _fernet().encrypt(str(g["client_secret"]).encode()).decode()
        if "redirect_uri" in g:
            gcfg["redirect_uri"] = str(g.get("redirect_uri") or "")
        update["google"] = gcfg

    if isinstance(payload.get("razorpay"), dict):
        r = payload["razorpay"]
        rcfg = dict((doc or {}).get("razorpay") or {})
        if "enabled" in r:
            rcfg["enabled"] = bool(r["enabled"])
        if r.get("key_id"):
            rcfg["key_id_enc"] = _fernet().encrypt(str(r["key_id"]).encode()).decode()
        if r.get("key_secret") and r.get("key_secret") != "set":
            rcfg["key_secret_enc"] = _fernet().encrypt(str(r["key_secret"]).encode()).decode()
        if r.get("webhook_secret") and r.get("webhook_secret") != "set":
            rcfg["webhook_secret_enc"] = _fernet().encrypt(str(r["webhook_secret"]).encode()).decode()
        update["razorpay"] = rcfg

    if update:
        await db.settings.update_one({"_id": PLATFORM_CONFIG_ID}, {"$set": update}, upsert=True)
    return {"ok": True}


@api_router.get("/auth/google/login-url")
async def google_login_url(redirect_uri: str = Query(""), state: str = Query("")):
    """Return the Google OAuth consent URL if admin has configured credentials."""
    doc = await _load_platform_config()
    google = (doc or {}).get("google") or {}
    client_id = _decrypt_safe(google.get("client_id_enc"))
    if not (google.get("enabled") and client_id):
        return {"configured": False}
    ru = (google.get("redirect_uri") or "").strip() or redirect_uri
    if not ru:
        return {"configured": False}
    from urllib.parse import urlencode
    params = {
        "client_id": client_id,
        "redirect_uri": ru,
        "response_type": "code",
        "scope": "openid email profile",
        "access_type": "online",
        "include_granted_scopes": "true",
        "prompt": "select_account",
        "state": state or secrets.token_urlsafe(12),
    }
    return {
        "configured": True,
        "url": "https://accounts.google.com/o/oauth2/v2/auth?" + urlencode(params),
        "redirect_uri": ru,
    }


@api_router.post("/auth/local-test-login")
async def local_dev_member_login(payload: dict, request: Request):
    """Issue local member sessions only for configured loopback development users."""
    if not _is_local_dev_request(request) or not LOCAL_DEV_MEMBER_USERS:
        raise HTTPException(404, "Local test login is unavailable")
    if db is None:
        raise HTTPException(503, "Database unavailable")
    email = str((payload or {}).get("email") or "").strip().lower()
    password = (payload or {}).get("password")
    configured = LOCAL_DEV_MEMBER_USERS.get(email)
    if not configured or not local_test_password_matches(
        password, configured["password"]
    ):
        raise HTTPException(401, "Invalid local test credentials")

    member_id = "local-dev:" + hashlib.sha256(email.encode("utf-8")).hexdigest()
    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()
    from membership import normalize_member_preferences
    membership_config = _platform_membership(await _load_platform_config())
    try:
        await db.members.update_one(
            {"_id": member_id},
            {
                "$set": {
                    "email": email,
                    "name": email.partition("@")[0],
                    "provider": "local_test",
                    "local_dev_test_account": True,
                    "plan": configured["plan"],
                    "admin_plan_override": configured["plan"] != "normal",
                    "disabled_at": None,
                    "last_login_at": now_iso,
                },
                "$setOnInsert": {
                    "created_at": now_iso,
                    "preferences": normalize_member_preferences(
                        None, membership_config.get("preference_defaults")
                    ),
                },
            },
            upsert=True,
        )
    except Exception as exc:
        logger.warning("Local test member persistence failed (%s)", type(exc).__name__)
        raise HTTPException(503, "Could not prepare local test account")

    token = secrets.token_urlsafe(40)
    expiry = now + timedelta(seconds=MEMBER_SESSION_TTL_SECONDS)
    try:
        await db.member_sessions.insert_one({
            "_id": _member_session_storage_id(token),
            "user_id": member_id,
            "created_at": now,
            "last_seen_at": now,
            "expires_at": expiry,
            "ip": _client_ip(request),
            "user_agent": (request.headers.get("user-agent") or "")[:200],
            "local_dev_test_session": True,
        })
    except Exception as exc:
        logger.warning("Local test member session failed (%s)", type(exc).__name__)
        raise HTTPException(503, "Could not create local test session")
    return {
        "token": token,
        "member_token": token,
        "name": email.partition("@")[0],
        "email": email,
        "expires_in_seconds": MEMBER_SESSION_TTL_SECONDS,
        "expires_at": expiry.isoformat(),
        "is_member": True,
    }


@api_router.post("/auth/google/exchange")
async def google_exchange(payload: dict, request: Request):
    """Exchange a verified Google identity for a durable, subject-keyed session."""
    doc = await _load_platform_config()
    google = (doc or {}).get("google") or {}
    client_id = _decrypt_safe(google.get("client_id_enc"))
    client_secret = _decrypt_safe(google.get("client_secret_enc"))
    if not (google.get("enabled") and client_id and client_secret):
        raise HTTPException(400, "Google sign-in is not configured")
    code = (payload or {}).get("code")
    redirect_uri = (payload or {}).get("redirect_uri") or (google.get("redirect_uri") or "")
    if not code or not redirect_uri:
        raise HTTPException(400, "Missing code/redirect_uri")
    configured_redirect = (google.get("redirect_uri") or "").strip()
    if configured_redirect and redirect_uri != configured_redirect:
        raise HTTPException(400, "Google redirect URI does not match Admin settings")
    import httpx
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            tok = await client.post("https://oauth2.googleapis.com/token", data={
                "code": code,
                "client_id": client_id,
                "client_secret": client_secret,
                "redirect_uri": redirect_uri,
                "grant_type": "authorization_code",
            })
            tok.raise_for_status()
            access = tok.json().get("access_token")
            if not access:
                raise HTTPException(400, "Google token exchange failed")
            info = await client.get(
                "https://openidconnect.googleapis.com/v1/userinfo",
                headers={"Authorization": f"Bearer {access}"},
            )
            info.raise_for_status()
            profile = info.json()
    except HTTPException:
        raise
    except Exception as e:
        logger.warning("Google OAuth exchange failed (%s)", type(e).__name__)
        raise HTTPException(400, "Google sign-in failed. Please try again.")

    email = (profile.get("email") or "").lower().strip()
    subject = str(profile.get("sub") or "").strip()
    verified = profile.get("email_verified") is True or str(profile.get("email_verified")).lower() == "true"
    if not (subject and email and verified):
        raise HTTPException(400, "Google must provide a stable subject and verified email")
    if db is None:
        raise HTTPException(503, "Database unavailable")
    config = _platform_membership(doc)
    member = await _find_one_capped(db.members, {"_id": subject})
    if not member:
        member = await _find_one_capped(db.members, {"google_subject": subject})
    legacy_member = None
    if not member:
        legacy_member = await _find_one_capped(
            db.members, {"email": email, "provider": "google"}
        )
    if not member and not legacy_member and not (
        config["experience_enabled"] and config["signup_enabled"]
    ):
        raise HTTPException(403, "New member sign-up is currently disabled")

    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()
    member_id = (
        member.get("_id") if member
        else legacy_member.get("_id") if legacy_member
        else subject
    )
    from membership import normalize_member_preferences
    default_preferences = normalize_member_preferences(config.get("preference_defaults"))
    member_update = {"$set": {
        "email": email,
        "name": str(profile.get("name") or email.partition("@")[0])[:120],
        "picture": str(profile.get("picture") or "")[:2048] or None,
        "last_login_at": now_iso,
        "provider": "google",
        "google_subject": subject,
    }}
    if not member and not legacy_member:
        member_update["$setOnInsert"] = {
            "created_at": now_iso,
            "plan": "normal",
            "preferences": default_preferences,
        }
    try:
        await db.members.update_one(
            {"_id": member_id},
            member_update,
            upsert=not member and not legacy_member,
        )
    except Exception as e:
        logger.warning("Google member account persistence failed (%s)", type(e).__name__)
        raise HTTPException(503, "Could not persist member account")

    token = secrets.token_urlsafe(40)
    expiry = now + timedelta(seconds=MEMBER_SESSION_TTL_SECONDS)
    try:
        await db.member_sessions.insert_one({
            "_id": _member_session_storage_id(token),
            "user_id": member_id,
            "created_at": now,
            "last_seen_at": now,
            "expires_at": expiry,
            "ip": _client_ip(request),
            "user_agent": (request.headers.get("user-agent") or "")[:200],
        })
    except Exception as e:
        logger.warning("Google member session persistence failed (%s)", type(e).__name__)
        raise HTTPException(503, "Could not create member session")
    return {
        # `token` preserves the existing browser header flow; new clients may
        # send the same value explicitly as X-Member-Token.
        "token": token,
        "member_token": token,
        "name": str(profile.get("name") or email.partition("@")[0])[:120],
        "email": email,
        "expires_in_seconds": MEMBER_SESSION_TTL_SECONDS,
        "expires_at": expiry.isoformat(),
        "is_member": True,
    }


@api_router.get("/membership/me")
async def membership_me(request: Request):
    sess, config, plan = await _member_context(request)
    from membership import normalize_member_preferences, plan_features
    member = sess["member"]
    defaults = config.get("preference_defaults") or {}
    prefs = normalize_member_preferences(member.get("preferences"), defaults)
    sub = member.get("subscription") or {}
    history_rows = await db.member_audit.find(
        {
            "member_id": sess["member_id"],
            "event_type": {
                "$in": [
                    "subscription_checkout_created",
                    "subscription_renewal_cancelled",
                    "subscription_status_changed",
                ]
            },
        },
        {"_id": 0, "event_type": 1, "details": 1, "created_at": 1},
    ).sort("created_at", -1).to_list(length=25)
    # The member ID filter and strict field allowlist keep this history private and redacted.
    return {
        "member": {
            "id": member["_id"],
            "email": member.get("email"),
            "name": member.get("name"),
            "picture": member.get("picture"),
            "created_at": member.get("created_at"),
        },
        "is_local_test_account": bool(member.get("local_dev_test_account")),
        "plan": plan,
        "features": sorted(plan_features(config, plan)),
        "subscription": {
            "id": sub.get("id"),
            "plan": sub.get("plan"),
            "cadence": sub.get("cadence"),
            "status": sub.get("status"),
            "current_end": sub.get("current_end"),
            "checkout_url": (
                sub.get("checkout_url")
                if sub.get("status") in ("created", "authenticated")
                else None
            ),
        },
        "subscription_history": [
            {
                "event_type": row.get("event_type"),
                "details": {
                    key: value for key, value in (row.get("details") or {}).items()
                    if key in {"plan", "cadence", "status", "access_ends_immediately"}
                },
                "created_at": row.get("created_at"),
            }
            for row in history_rows
        ],
        "preferences": prefs,
    }


@api_router.get("/membership/preferences")
async def membership_preferences_get(request: Request):
    sess, config, _plan = await _member_context(request)
    from membership import normalize_member_preferences
    return {
        "preferences": normalize_member_preferences(
            sess["member"].get("preferences"),
            config.get("preference_defaults"),
        )
    }


@api_router.put("/membership/preferences")
async def membership_preferences_save(payload: dict, request: Request):
    sess, config, _plan = await _member_context(request)
    from membership import normalize_member_preferences
    stored_preferences = sess["member"].get("preferences") or {}
    prefs = normalize_member_preferences(
        payload or {},
        config.get("preference_defaults"),
    )
    # Trade-cycle retention is an administrator-controlled privacy opt-in.
    prefs["trade_cycle_persistence_enabled"] = bool(
        stored_preferences.get("trade_cycle_persistence_enabled", False)
    )
    await db.members.update_one(
        {"_id": sess["member_id"]},
        {"$set": {"preferences": prefs, "preferences_updated_at": datetime.now(timezone.utc).isoformat()}},
    )
    return {"ok": True, "preferences": prefs}


@api_router.get("/membership/journal/{day}")
async def member_journal_get(day: str, request: Request):
    sess, _config, _plan = await _member_context(request, "trade_journal")
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", day):
        raise HTTPException(400, "Use YYYY-MM-DD")
    try:
        datetime.strptime(day, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(400, "Invalid journal date")
    record = await db.member_journal.find_one(
        {"user_id": sess["member_id"], "date": day},
        {"_id": 0, "user_id": 0},
    )
    if not record:
        return {"date": day, "empty": True, "tags": journal.DEFAULT_TAGS}
    result = journal.public_day(record, include_images=True)
    result["empty"] = False
    result["tags_catalog"] = journal.DEFAULT_TAGS
    return result


@api_router.get("/membership/journal")
async def member_journal_month(
    year: int,
    request: Request,
    month: Optional[int] = None,
    view: Optional[str] = None,
):
    sess, _config, _plan = await _member_context(request, "trade_journal")
    if year < 2020 or year > 2100:
        raise HTTPException(400, "Invalid year/month")
    if (view or "").lower() == "year":
        start, end = f"{year:04d}-01-01", f"{year + 1:04d}-01-01"
        try:
            docs = await db.member_journal.find(
                {"user_id": sess["member_id"], "date": {"$gte": start, "$lt": end}},
                {"_id": 0, "user_id": 0, "screenshots": 0},
            ).to_list(length=400)
        except Exception as exc:
            logger.exception("member journal year query failed")
            raise HTTPException(503, "Could not load your journal year") from exc
        days = [journal.public_day(doc, include_images=False) for doc in docs]
        days = [day for day in days if day and journal.include_on_journal_calendar(day)]
        return {
            "year": year,
            "today": journal.ist_ymd(),
            "stats": journal.month_stats(days),
            "heatmap": journal.year_heatmap(days, year),
            "tags": journal.DEFAULT_TAGS,
        }
    month = int(month or now_ist().month)
    if month < 1 or month > 12:
        raise HTTPException(400, "Invalid year/month")
    start, end = journal.month_bounds(year, month)
    try:
        # The authenticated member ID is the ownership boundary; never accept it from the query.
        days = await db.member_journal.find(
            {"user_id": sess["member_id"], "date": {"$gte": start, "$lt": end}},
            {"_id": 0, "user_id": 0, "screenshots.data": 0},
        ).to_list(length=40)
    except Exception as exc:
        logger.exception("member journal month query failed")
        raise HTTPException(503, "Could not load your journal calendar") from exc
    days = [journal.public_day(day, include_images=False) for day in days]
    days = [day for day in days if day and journal.include_on_journal_calendar(day)]
    days.sort(key=lambda record: record.get("date") or "")
    return {
        "year": year,
        "month": month,
        "today": journal.ist_ymd(),
        "days": days,
        "stats": journal.month_stats(days),
        "tags": journal.DEFAULT_TAGS,
    }


@api_router.get("/membership/journal-period")
async def member_journal_period(
    request: Request,
    start: str = Query(..., alias="from"),
    end: str = Query(..., alias="to"),
):
    sess, _config, _plan = await _member_context(request, "trade_journal")
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", start) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", end):
        raise HTTPException(400, "Use YYYY-MM-DD for from and to")
    if start > end:
        raise HTTPException(400, "from must be on or before to")
    try:
        first = datetime.strptime(start, "%Y-%m-%d")
        last = datetime.strptime(end, "%Y-%m-%d")
    except ValueError as exc:
        raise HTTPException(400, "Invalid from/to date") from exc
    if (last - first).days > 400:
        raise HTTPException(400, "Range too long (max 400 days)")
    try:
        docs = await db.member_journal.find(
            {"user_id": sess["member_id"], "date": {"$gte": start, "$lte": end}},
            {"_id": 0, "user_id": 0, "screenshots": 0},
        ).to_list(length=420)
    except Exception as exc:
        logger.exception("member journal period query failed")
        raise HTTPException(503, "Could not load your journal period") from exc
    days = [journal.public_day(doc, include_images=False) for doc in docs]
    days = [day for day in days if day]
    return {
        "from": start,
        "to": end,
        "index": "ALL",
        "today": journal.ist_ymd(),
        "stats": journal.period_stats(days, start=start, end=end),
        "indices": list(journal.HEATMAP_INDICES),
    }


@api_router.put("/membership/journal/{day}")
async def member_journal_save(day: str, payload: JournalIn, request: Request):
    sess, _config, _plan = await _member_context(request, "trade_journal")
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", day):
        raise HTTPException(400, "Use YYYY-MM-DD")
    try:
        datetime.strptime(day, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(400, "Invalid journal date")
    fields = journal.sanitize_journal_fields(payload.model_dump(exclude_unset=True))
    now = datetime.now(timezone.utc).isoformat()
    await db.member_journal.update_one(
        {"user_id": sess["member_id"], "date": day},
        {"$set": {**fields, "updated_at": now}, "$setOnInsert": {
            "user_id": sess["member_id"],
            "date": day,
            "created_at": now,
        }},
        upsert=True,
    )
    record = await db.member_journal.find_one(
        {"user_id": sess["member_id"], "date": day},
        {"_id": 0, "user_id": 0},
    )
    return {
        "ok": True,
        "journal": journal.public_day(record, include_images=False),
    }


@api_router.post("/membership/journal/{day}/screenshot")
async def member_journal_add_shot(day: str, payload: JournalShotIn, request: Request):
    sess, _config, _plan = await _member_context(request, "trade_journal")
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", day):
        raise HTTPException(400, "Use YYYY-MM-DD")
    try:
        datetime.strptime(day, "%Y-%m-%d")
    except ValueError as exc:
        raise HTTPException(400, "Invalid journal date") from exc
    try:
        shot = journal.decode_screenshot(payload.model_dump())
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    owner_day = {"user_id": sess["member_id"], "date": day}
    doc = await db.member_journal.find_one(owner_day, {"screenshots": 1})
    existing = (doc or {}).get("screenshots") or []
    if len(existing) >= journal.MAX_SCREENSHOTS:
        raise HTTPException(400, f"Max {journal.MAX_SCREENSHOTS} screenshots per day")
    now = datetime.now(timezone.utc).isoformat()
    await db.member_journal.update_one(
        owner_day,
        {"$set": {"date": day, "updated_at": now}, "$push": {"screenshots": shot},
         "$setOnInsert": {"user_id": sess["member_id"], "created_at": now}},
        upsert=True,
    )
    return {"id": shot["id"], "name": shot["name"], "mime": shot["mime"]}


@api_router.delete("/membership/journal/{day}/screenshot/{shot_id}")
async def member_journal_del_shot(day: str, shot_id: str, request: Request):
    sess, _config, _plan = await _member_context(request, "trade_journal")
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", day):
        raise HTTPException(400, "Use YYYY-MM-DD")
    await db.member_journal.update_one(
        {"user_id": sess["member_id"], "date": day},
        {"$pull": {"screenshots": {"id": shot_id}}},
    )
    return {"deleted": shot_id}


@api_router.get("/membership/alerts")
async def member_alerts_get(
    request: Request,
    limit: int = Query(50, ge=1, le=100),
):
    await _member_context(request, "alerts")
    return await get_alerts(request, limit)


@api_router.post("/membership/alerts/oi-shift")
async def member_oi_shift_alert_save(payload: dict, request: Request):
    sess, membership_config, _plan = await _member_context(request, "alerts")
    await _member_context(request, "oi_shift_alerts")
    if db is None:
        raise HTTPException(503, "Alert inbox storage unavailable")

    from membership import normalize_member_preferences, next_member_alert_purge

    prefs = normalize_member_preferences(
        sess["member"].get("preferences"),
        membership_config.get("preference_defaults"),
    )
    if not prefs["alert_types"].get("oi_shift", True):
        raise HTTPException(403, "OI shift alerts are disabled in your preferences")

    index = payload.get("index")
    if (
        not isinstance(index, str)
        or index not in {"NIFTY", "SENSEX", "BANKNIFTY"}
        or index not in prefs["alert_indices"]
    ):
        raise HTTPException(400, "This index is not enabled for your alerts")
    event_key = payload.get("id")
    if not isinstance(event_key, str) or not event_key.strip() or len(event_key) > 160:
        raise HTTPException(400, "Invalid alert event identifier")
    side = payload.get("side")
    if not isinstance(side, str) or side not in {"CE", "PE"}:
        raise HTTPException(400, "Invalid OI shift side")
    try:
        raw_window = payload.get("window")
        window = int(raw_window)
        value = float(payload.get("value"))
        atm = float(payload.get("atm"))
    except (TypeError, ValueError):
        raise HTTPException(400, "Invalid OI shift values")
    if (
        isinstance(raw_window, bool)
        or (isinstance(raw_window, float) and raw_window != window)
        or window < 1 or window > 60
        or isinstance(payload.get("value"), bool)
        or not math.isfinite(value)
        or isinstance(payload.get("atm"), bool)
        or not math.isfinite(atm)
        or atm <= 0
    ):
        raise HTTPException(400, "Invalid OI shift values")
    if abs(value) < float(prefs["oi_shift_threshold_contracts"]):
        raise HTTPException(400, "OI shift is below your configured alert threshold")

    price = payload.get("price")
    if price is not None:
        try:
            price = float(price)
        except (TypeError, ValueError):
            raise HTTPException(400, "Invalid OI shift price")
        if isinstance(payload.get("price"), bool) or not math.isfinite(price) or price <= 0:
            raise HTTPException(400, "Invalid OI shift price")

    strikes = []
    contributing = payload.get("contributing")
    if isinstance(contributing, list):
        for strike in contributing[:3]:
            if not isinstance(strike, dict):
                raise HTTPException(400, "Invalid OI shift strike details")
            try:
                strike_value = float(strike.get("strike"))
                ce_delta = float(strike.get("ce_delta"))
                pe_delta = float(strike.get("pe_delta"))
            except (TypeError, ValueError):
                raise HTTPException(400, "Invalid OI shift strike details")
            if all(math.isfinite(item) for item in (strike_value, ce_delta, pe_delta)):
                strikes.append({
                    "strike": strike_value,
                    "ce_delta": ce_delta,
                    "pe_delta": pe_delta,
                })
            else:
                raise HTTPException(400, "Invalid OI shift strike details")

    member_id = str(sess["member_id"])
    now = datetime.now(timezone.utc)
    # Scope deduplication to the authenticated member while keeping retries idempotent.
    event_digest = hashlib.sha256(f"{member_id}:{event_key.strip()}".encode()).hexdigest()
    alert_id = f"oi-shift-{event_digest}"
    direction = "build" if value > 0 else "unwind"
    event = {
        "_id": event_digest,
        "alert_id": alert_id,
        "user_id": member_id,
        "type": "oi_shift",
        "index": index,
        "created_at": now.isoformat(),
        "expire_at": next_member_alert_purge(now),
        "price": price,
        "atm": atm,
        "direction": direction,
        "severity": "HIGH",
        "side": side,
        "window": window,
        "value": value,
        "strikes": strikes,
        "message": f"{side} OI {direction} of {abs(value):,.0f} contracts in {window} min near ATM ±1",
    }
    await db.member_alert_events.update_one(
        {"_id": event_digest},
        {"$setOnInsert": event},
        upsert=True,
    )
    stored = await db.member_alert_events.find_one(
        {"_id": event_digest},
        {"_id": 0, "user_id": 0, "expire_at": 0},
    )
    if not stored:
        raise HTTPException(503, "Could not save OI shift alert")
    return {"alert": {**stored, "seen": False}}


@api_router.post("/membership/alerts/{alert_id}/ack")
async def member_alert_ack(alert_id: str, request: Request):
    sess, _config, _plan = await _member_context(request, "alerts")
    result = await db.member_alerts.update_one(
        {"user_id": sess["member_id"], "source_alert_id": alert_id},
        {"$set": {"seen": True, "seen_at": datetime.now(timezone.utc)},
         "$setOnInsert": {
             "user_id": sess["member_id"],
             "source_alert_id": alert_id,
             "created_at": datetime.now(timezone.utc),
         }},
        upsert=True,
    )
    return {"ok": True, "updated": bool(result.modified_count or result.upserted_id)}


@api_router.get("/admin/members")
async def admin_members_list(
    member_id: Optional[str] = None,
    _admin: bool = Depends(require_admin),
):
    member_query = {"_id": member_id} if member_id else {}
    rows = await db.members.find(
        member_query,
        {"_id": 1, "email": 1, "name": 1, "plan": 1, "created_at": 1,
         "last_login_at": 1, "disabled_at": 1, "admin_plan_override": 1,
         "linked_kite_user_id": 1,
         "subscription.status": 1, "subscription.current_end": 1,
         "preferences.trade_cycle_persistence_enabled": 1},
    ).sort("created_at", -1).to_list(length=1 if member_id else 500)
    member_ids = [row.get("_id") for row in rows if row.get("_id")]
    kite_rows = await db.user_kite.find(
        {"member_id": {"$in": member_ids}},
        {"_id": 0, "member_id": 1, "kite_user_id": 1, "valid_until": 1},
    ).to_list(length=len(member_ids))
    kite_by_member = {row["member_id"]: row for row in kite_rows if row.get("member_id")}
    return {
        "members": [{
            "id": row.get("_id"),
            "email": row.get("email"),
            "name": row.get("name"),
            "plan": _effective_member_plan(row),
            "created_at": row.get("created_at"),
            "last_login_at": row.get("last_login_at"),
            "disabled": bool(row.get("disabled_at")),
            "admin_plan_override": bool(row.get("admin_plan_override")),
            "linked_kite_user_id": row.get("linked_kite_user_id"),
            "subscription": row.get("subscription"),
            "trade_cycle_persistence_enabled": (
                (row.get("preferences") or {}).get("trade_cycle_persistence_enabled", False)
            ),
            "kite_account": kite_by_member.get(row.get("_id")),
        } for row in rows]
    }


@api_router.get("/admin/subscription-health")
async def admin_subscription_health(_admin: bool = Depends(require_admin)):
    if db is None:
        raise HTTPException(503, "Database unavailable")

    platform_doc = await _load_platform_config()
    membership = _platform_membership(platform_doc or {})
    member_rows = await db.members.find(
        {},
        {
            "_id": 1, "name": 1, "email": 1, "plan": 1, "disabled_at": 1,
            "admin_plan_override": 1, "subscription": 1,
        },
    ).to_list(length=None)
    active_members = {"normal": 0, "premium": 0, "pro": 0}
    blocked_basic_members = 0
    blocked_basic_rows = []
    payment_attention_rows = []
    basic_enabled = bool(membership["plans"]["normal"]["enabled"])
    experience_enabled = bool(membership["experience_enabled"])
    now = datetime.now(timezone.utc)
    payment_attention_statuses = {"past_due", "halted", "paused", "refunded", "expired"}

    for member in member_rows:
        is_disabled = bool(member.get("disabled_at"))
        plan = _effective_member_plan(member)
        subscription = member.get("subscription") or {}
        status = str(subscription.get("status") or "").lower()
        if not is_disabled and not basic_enabled and plan == "normal":
            blocked_basic_members += 1
            blocked_basic_rows.append({
                "id": member.get("_id"),
                "name": member.get("name"),
                "email": member.get("email"),
                "payment_status": status or None,
            })
        if not is_disabled and experience_enabled and membership["plans"][plan]["enabled"]:
            active_members[plan] += 1
        updated_at = subscription.get("updated_at") or subscription.get("created_at")
        pending_is_stale = False
        if status in {"created", "authenticated"} and updated_at:
            try:
                pending_at = (
                    datetime.fromtimestamp(updated_at, timezone.utc)
                    if isinstance(updated_at, (int, float))
                    else datetime.fromisoformat(str(updated_at).replace("Z", "+00:00"))
                )
                if pending_at.tzinfo is None:
                    pending_at = pending_at.replace(tzinfo=timezone.utc)
                pending_is_stale = (now - pending_at).total_seconds() >= 30 * 60
            except (TypeError, ValueError, OverflowError):
                pending_is_stale = False
        attention_status = status
        if status == "active" and subscription.get("current_end") is not None:
            try:
                active_end = subscription["current_end"]
                active_end = (
                    datetime.fromtimestamp(active_end, timezone.utc)
                    if isinstance(active_end, (int, float))
                    else datetime.fromisoformat(str(active_end).replace("Z", "+00:00"))
                )
                if active_end.tzinfo is None:
                    active_end = active_end.replace(tzinfo=timezone.utc)
                if active_end <= now:
                    attention_status = "expired"
            except (TypeError, ValueError, OverflowError):
                attention_status = status
        # Surface abandoned hosted checkouts after a short window without treating fresh ones as failures.
        if attention_status in payment_attention_statuses or pending_is_stale:
            payment_attention_rows.append({
                "id": member.get("_id"),
                "name": member.get("name"),
                "email": member.get("email"),
                "plan": subscription.get("plan") or plan,
                "payment_status": attention_status,
                "updated_at": updated_at,
            })

    billing_events = db.billing_events
    return {
        "active_members_by_plan": active_members,
        "all_time": {
            "renewals": await billing_events.count_documents({"event_type": "subscription.charged"}),
            "cancellations": await billing_events.count_documents({"event_type": "subscription.cancelled"}),
            "failed_payments": await billing_events.count_documents({"event_type": "payment.failed"}),
        },
        "blocked_basic_members": blocked_basic_members,
        "blocked_basic_member_list": blocked_basic_rows[:50],
        "blocked_basic_members_truncated": max(0, blocked_basic_members - 50),
        "payment_attention_members": payment_attention_rows[:50],
        "payment_attention_members_count": len(payment_attention_rows),
        "payment_attention_members_truncated": max(0, len(payment_attention_rows) - 50),
        "basic_plan_enabled": basic_enabled,
        "membership_experience_enabled": experience_enabled,
    }


@api_router.get("/admin/members/{member_id}/audit")
async def admin_member_audit(member_id: str, _admin: bool = Depends(require_admin)):
    if db is None:
        raise HTTPException(503, "Database unavailable")
    if not await db.members.find_one({"_id": member_id}, {"_id": 1}):
        raise HTTPException(404, "Member not found")
    events = await db.member_audit.find(
        {"member_id": member_id},
        {"_id": 0, "member_id": 0},
    ).sort("created_at", -1).to_list(length=50)
    return {"events": events}


@api_router.patch("/admin/members/{member_id}")
async def admin_member_update(member_id: str, payload: dict, _admin: bool = Depends(require_admin)):
    if db is None:
        raise HTTPException(503, "Database unavailable")
    member = await db.members.find_one({"_id": member_id})
    if not member:
        raise HTTPException(404, "Member not found")
    update = {}
    if "plan" in payload:
        plan = str(payload.get("plan") or "").lower()
        if plan not in ("normal", "premium", "pro"):
            raise HTTPException(400, "Unknown membership plan")
        update["plan"] = plan
        update["admin_plan_override"] = bool(payload.get("admin_plan_override", plan != "normal"))
    if "disabled" in payload:
        update["disabled_at"] = (
            datetime.now(timezone.utc).isoformat() if payload["disabled"] else None
        )
    if "preferences" in payload and isinstance(payload["preferences"], dict):
        from membership import normalize_member_preferences
        cfg = _platform_membership(await _load_platform_config())
        merged_preferences = {
            **(member.get("preferences") or {}),
            **payload["preferences"],
        }
        update["preferences"] = normalize_member_preferences(
            merged_preferences,
            cfg.get("preference_defaults"),
        )
    audit_details = {}
    if "plan" in update:
        audit_details["plan"] = {
            "from": _effective_member_plan(member),
            "to": update["plan"],
            "override": update["admin_plan_override"],
        }
    if "disabled_at" in update:
        audit_details["suspended"] = bool(update["disabled_at"])
    if "preferences" in update:
        old_cycle_storage = bool(
            (member.get("preferences") or {}).get("trade_cycle_persistence_enabled", False)
        )
        new_cycle_storage = bool(
            update["preferences"].get("trade_cycle_persistence_enabled", False)
        )
        if old_cycle_storage != new_cycle_storage:
            audit_details["trade_cycle_storage_enabled"] = new_cycle_storage
    if update:
        update["admin_updated_at"] = datetime.now(timezone.utc).isoformat()
        await db.members.update_one({"_id": member_id}, {"$set": update})
        if audit_details:
            await _record_member_audit(member_id, "admin_member_updated", "admin", audit_details)
    saved = await db.members.find_one({"_id": member_id})
    return {
        "ok": True,
        "member": {
            "id": saved.get("_id"),
            "plan": _effective_member_plan(saved),
            "disabled": bool(saved.get("disabled_at")),
            "admin_plan_override": bool(saved.get("admin_plan_override")),
            "preferences": saved.get("preferences") or {},
        },
    }


@api_router.post("/billing/checkout")
async def membership_checkout(payload: dict, request: Request):
    sess, config, _member_plan = await _member_context(request)
    if not config["paid_subscriptions_enabled"]:
        raise HTTPException(503, "Paid subscriptions are disabled")
    doc = await _load_platform_config()
    readiness = _billing_readiness(doc, config)
    if not readiness["ready"]:
        raise HTTPException(503, "Billing is not fully configured")
    requested_plan = str((payload or {}).get("plan") or "").lower()
    cadence = str((payload or {}).get("cadence") or "").lower()
    if requested_plan not in ("premium", "pro") or cadence not in ("monthly", "quarterly", "yearly"):
        raise HTTPException(400, "Choose a paid plan and monthly, quarterly, or yearly billing")
    plan_config = config["plans"].get(requested_plan) or {}
    if not plan_config.get("enabled"):
        raise HTTPException(400, "That plan is not available")
    pricing = _platform_pricing(doc)
    plan_price = pricing.get(requested_plan) or {}
    try:
        amount_paise = int(round(float(plan_price.get(cadence) or 0) * 100))
    except (TypeError, ValueError):
        amount_paise = 0
    plan_id = str((plan_price.get("razorpay_plan_ids") or {}).get(cadence) or "").strip()
    if amount_paise <= 0 or not plan_id:
        raise HTTPException(503, "The selected Razorpay plan is not configured")
    rp = (doc or {}).get("razorpay") or {}
    key_id = _decrypt_safe(rp.get("key_id_enc"))
    key_secret = _decrypt_safe(rp.get("key_secret_enc"))
    if not key_id or not key_secret:
        raise HTTPException(503, "Billing credentials are unavailable")
    member_id = sess["member_id"]
    member_subscription = (sess["member"].get("subscription") or {})
    current_end = member_subscription.get("current_end")
    if isinstance(current_end, (int, float)):
        current_end = datetime.fromtimestamp(current_end, timezone.utc)
    elif isinstance(current_end, str):
        try:
            current_end = datetime.fromisoformat(current_end)
        except ValueError:
            current_end = None
    if (
        _effective_member_plan(sess["member"]) in ("premium", "pro")
        and member_subscription.get("status") == "active"
        and isinstance(current_end, datetime)
        and (current_end.replace(tzinfo=timezone.utc) if current_end.tzinfo is None else current_end)
            > datetime.now(timezone.utc)
    ):
        raise HTTPException(409, "Your current paid access must end before starting another subscription")
    active = await db.member_subscriptions.find_one({
        "user_id": member_id,
        "status": {"$in": ["created", "authenticated", "active"]},
    })
    if active:
        active_end = active.get("current_end")
        if isinstance(active_end, (int, float)):
            active_end = datetime.fromtimestamp(active_end, timezone.utc)
        elif isinstance(active_end, str):
            try:
                active_end = datetime.fromisoformat(active_end)
            except ValueError:
                active_end = None
        if isinstance(active_end, datetime) and active_end.tzinfo is None:
            active_end = active_end.replace(tzinfo=timezone.utc)
        created_at = active.get("created_at")
        if isinstance(created_at, str):
            try:
                created_at = datetime.fromisoformat(created_at)
            except ValueError:
                created_at = None
        if isinstance(created_at, datetime) and created_at.tzinfo is None:
            created_at = created_at.replace(tzinfo=timezone.utc)
        active_period_remains = (
            active.get("status") == "active"
            and (active_end is None or active_end > datetime.now(timezone.utc))
        )
        pending_checkout_is_fresh = (
            active.get("status") in ("created", "authenticated")
            and isinstance(created_at, datetime)
            and created_at > datetime.now(timezone.utc) - timedelta(minutes=20)
        )
        if active_period_remains or pending_checkout_is_fresh:
            raise HTTPException(409, "An active or pending subscription already exists")

    request_body = {
        "plan_id": plan_id,
        "total_count": 120,
        "quantity": 1,
        "customer_notify": 1,
        "notes": {
            "member_id": member_id,
            "plan": requested_plan,
            "cadence": cadence,
        },
    }
    early = config.get("early_access") or {}
    try:
        first_period_offer_price = _configured_offer_price(plan_price, cadence)
    except ValueError as exc:
        raise HTTPException(503, "The selected first-period offer price is invalid") from exc
    discount = (
        int(early.get("discount_percent") or 0)
        if early.get("enabled") and first_period_offer_price is None
        else 0
    )
    offer_id = str((plan_price.get("razorpay_offer_ids") or {}).get(cadence) or "").strip()
    if discount or first_period_offer_price is not None:
        if not offer_id:
            raise HTTPException(
                503,
                "The first-period price requires a matching Razorpay offer ID for this billing cadence",
            )
        request_body["offer_id"] = offer_id
    import httpx
    try:
        async with httpx.AsyncClient(timeout=15, auth=(key_id, key_secret)) as client:
            provider_plan = await client.get(f"https://api.razorpay.com/v1/plans/{plan_id}")
            provider_plan.raise_for_status()
            provider_plan = provider_plan.json()
            item = provider_plan.get("item") or {}
            if (
                int(item.get("amount") or 0) != amount_paise
                or str(item.get("currency") or "").upper() != str(pricing.get("currency") or "INR").upper()
            ):
                raise HTTPException(503, "Razorpay plan amount or currency does not match Admin pricing")
            response = await client.post(
                "https://api.razorpay.com/v1/subscriptions",
                json=request_body,
            )
            response.raise_for_status()
            subscription = response.json()
    except HTTPException:
        raise
    except Exception as e:
        logger.warning("Razorpay checkout failed (%s)", type(e).__name__)
        raise HTTPException(502, "Razorpay checkout is temporarily unavailable")
    subscription_id = str(subscription.get("id") or "")
    short_url = str(subscription.get("short_url") or "")
    if not subscription_id or not short_url:
        raise HTTPException(502, "Razorpay did not return a valid subscription checkout")
    now = datetime.now(timezone.utc)
    await db.member_subscriptions.update_one(
        {"_id": subscription_id},
        {"$set": {
            "user_id": member_id,
            "plan": requested_plan,
            "cadence": cadence,
            "plan_id": plan_id,
            "status": "created",
            "checkout_url": short_url,
            "current_end": subscription.get("current_end"),
            "discount_percent": discount,
            "offer_id": offer_id or None,
            "first_period_price": first_period_offer_price,
            "created_at": now,
            "updated_at": now,
        }},
        upsert=True,
    )
    await db.members.update_one(
        {"_id": member_id},
        {"$set": {
            "subscription.id": subscription_id,
            "subscription.plan": requested_plan,
            "subscription.cadence": cadence,
            "subscription.status": "created",
            "subscription.checkout_url": short_url,
            "subscription.updated_at": now.isoformat(),
        }},
    )
    if subscription.get("current_end") is not None:
        await db.members.update_one(
            {"_id": member_id},
            {"$set": {"subscription.current_end": subscription["current_end"]}},
        )
    await _record_member_audit(
        member_id,
        "subscription_checkout_created",
        "member",
        {"plan": requested_plan, "cadence": cadence},
    )
    return {
        "subscription_id": subscription_id,
        "short_url": short_url,
        "key_id": key_id,
        "plan": requested_plan,
        "cadence": cadence,
        "price": plan_price[cadence],
        "regular_price": plan_price[cadence],
        "first_period_price": first_period_offer_price or plan_price[cadence],
        "currency": pricing.get("currency") or "INR",
        "discount_percent": discount,
    }


@api_router.post("/billing/cancel")
async def membership_cancel(request: Request):
    sess, _config, _plan = await _member_context(request)
    if db is None:
        raise HTTPException(503, "Database unavailable")
    sub_id = str((sess["member"].get("subscription") or {}).get("id") or "")
    if not sub_id:
        raise HTTPException(404, "No provider subscription is linked to this account")
    stored = await db.member_subscriptions.find_one({
        "_id": sub_id,
        "user_id": sess["member_id"],
        "status": {"$in": ["created", "authenticated", "active"]},
    })
    if not stored:
        raise HTTPException(409, "No cancellable subscription was found")
    doc = await _load_platform_config()
    rp = (doc or {}).get("razorpay") or {}
    key_id = _decrypt_safe(rp.get("key_id_enc"))
    key_secret = _decrypt_safe(rp.get("key_secret_enc"))
    if not (rp.get("enabled") and key_id and key_secret):
        raise HTTPException(503, "Billing credentials are unavailable")
    import httpx
    try:
        async with httpx.AsyncClient(timeout=15, auth=(key_id, key_secret)) as client:
            response = await client.post(
                f"https://api.razorpay.com/v1/subscriptions/{sub_id}/cancel",
                json={"cancel_at_cycle_end": 0},
            )
            response.raise_for_status()
            provider_sub = response.json()
    except Exception as exc:
        logger.warning("Razorpay cancellation failed (%s)", type(exc).__name__)
        raise HTTPException(502, "Could not cancel the subscription. Please retry.")
    now = datetime.now(timezone.utc)
    current_end = (
        provider_sub.get("current_end")
        or stored.get("current_end")
        or (sess["member"].get("subscription") or {}).get("current_end")
    )
    await db.member_subscriptions.update_one(
        {"_id": sub_id, "user_id": sess["member_id"]},
        {"$set": {
            "status": "cancelled",
            "current_end": current_end,
            "updated_at": now,
        }},
    )
    member_update = {
        "plan": "normal",
        "admin_plan_override": False,
        "subscription.status": "cancelled",
        "subscription.updated_at": now.isoformat(),
    }
    if current_end is not None:
        member_update["subscription.current_end"] = current_end
    await db.members.update_one({"_id": sess["member_id"]}, {"$set": member_update})
    await _record_member_audit(
        sess["member_id"],
        "subscription_renewal_cancelled",
        "member",
        {"current_end": current_end, "access_ends_immediately": True},
    )
    return {"ok": True, "status": "cancelled", "plan": "normal", "current_end": current_end}


@api_router.post("/billing/razorpay/webhook")
async def razorpay_webhook(request: Request):
    if db is None:
        raise HTTPException(503, "Database unavailable")
    doc = await _load_platform_config()
    rp = (doc or {}).get("razorpay") or {}
    secret = _decrypt_safe(rp.get("webhook_secret_enc"))
    if not (rp.get("enabled") and secret):
        raise HTTPException(503, "Razorpay webhook is not configured")
    body = await request.body()
    if not body or len(body) > 1024 * 1024:
        raise HTTPException(413, "Invalid webhook payload")
    signature = request.headers.get("x-razorpay-signature") or ""
    expected = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    if not signature or not hmac.compare_digest(expected, signature):
        raise HTTPException(401, "Invalid Razorpay webhook signature")
    try:
        event = json.loads(body)
    except (ValueError, TypeError):
        raise HTTPException(400, "Invalid webhook JSON")
    event_type = str(event.get("event") or "")
    event_id = (
        request.headers.get("x-razorpay-event-id")
        or str(event.get("id") or "")
        or hashlib.sha256(body).hexdigest()
    )
    delivered = await db.billing_events.find_one({"_id": event_id}, {"_id": 1})
    if delivered:
        return {"ok": True, "duplicate": True}
    payload_data = event.get("payload") or {}
    subscription = ((payload_data.get("subscription") or {}).get("entity") or {})
    subscription_id = str(subscription.get("id") or "")
    payment = {}
    if not subscription_id and event_type in ("payment.failed", "payment.refunded"):
        payment = ((payload_data.get("payment") or {}).get("entity") or {})
        subscription_id = str(payment.get("subscription_id") or "")
    elif event_type in ("payment.failed", "payment.refunded"):
        payment = ((payload_data.get("payment") or {}).get("entity") or {})
    stored = await db.member_subscriptions.find_one({"_id": subscription_id}) if subscription_id else None
    if not stored:
        return {"ok": True, "ignored": True}
    event_created_at = event.get("created_at")
    try:
        event_created_at = int(event_created_at) if event_created_at is not None else None
    except (TypeError, ValueError):
        event_created_at = None
    last_event_created_at = stored.get("last_event_created_at")
    if (
        event_created_at is not None
        and isinstance(last_event_created_at, (int, float))
        and event_created_at < last_event_created_at
    ):
        await db.billing_events.update_one(
            {"_id": event_id},
            {"$setOnInsert": {
                "event_type": event_type,
                "subscription_id": subscription_id,
                "received_at": datetime.now(timezone.utc),
                "ignored_as_stale": True,
            }},
            upsert=True,
        )
        return {"ok": True, "ignored": True, "stale": True}
    state_by_event = {
        "subscription.activated": "active",
        "subscription.charged": "active",
        "subscription.resumed": "active",
        "subscription.cancelled": "cancelled",
        "subscription.completed": "completed",
        "subscription.expired": "expired",
        "subscription.halted": "halted",
        "subscription.paused": "paused",
        "payment.failed": "past_due",
    }
    status = state_by_event.get(event_type)
    if event_type == "payment.refunded":
        amount = int(payment.get("amount") or 0)
        amount_refunded = int(payment.get("amount_refunded") or 0)
        if amount > 0 and amount_refunded >= amount:
            status = "refunded"
    if not status:
        return {"ok": True, "ignored": True}
    current_end = subscription.get("current_end")
    now = datetime.now(timezone.utc)
    set_fields = {
        "status": status,
        "updated_at": now,
        "last_event_id": event_id,
        "last_event_type": event_type,
    }
    if event_created_at is not None:
        set_fields["last_event_created_at"] = event_created_at
    if current_end is not None:
        set_fields["current_end"] = current_end
    if payment.get("id"):
        set_fields["last_payment_id"] = str(payment["id"])
    await db.member_subscriptions.update_one({"_id": subscription_id}, {"$set": set_fields})
    member_update = {
        "subscription.id": subscription_id,
        "subscription.plan": stored.get("plan"),
        "subscription.cadence": stored.get("cadence"),
        "subscription.status": status,
        "subscription.updated_at": now.isoformat(),
    }
    if status not in ("created", "authenticated"):
        member_update["subscription.checkout_url"] = None
    if current_end is not None:
        member_update["subscription.current_end"] = current_end
    if stored.get("plan") in ("premium", "pro"):
        member_update["plan"] = stored["plan"] if status == "active" else "normal"
        member_update["admin_plan_override"] = False
    await db.members.update_one({"_id": stored["user_id"]}, {"$set": member_update})
    await db.billing_events.update_one(
        {"_id": event_id},
        {"$setOnInsert": {
            "event_type": event_type,
            "subscription_id": subscription_id,
            "received_at": now,
            "event_created_at": event_created_at,
        }},
        upsert=True,
    )
    await _record_member_audit(
        stored["user_id"],
        "subscription_status_changed",
        "razorpay",
        {
            "plan": stored.get("plan"),
            "status": status,
            "event_type": event_type,
        },
    )
    return {"ok": True}


async def _purge_old_alert_history():
    if db is None:
        return
    from membership import member_alert_purge_cutoff
    cutoff = member_alert_purge_cutoff()
    await db.member_alerts.delete_many({"created_at": {"$lt": cutoff}})
    await db.alerts.delete_many({"created_at": {"$lt": cutoff.isoformat()}})


async def _member_alert_cleanup_loop():
    """Remove prior-day shared and member alert records at 09:00 IST, not via TTL lag."""
    from membership import next_member_alert_purge, member_alert_purge_cutoff
    try:
        await _purge_old_alert_history()
    except Exception:
        logger.exception("Initial alert retention cleanup failed")
    while True:
        try:
            target = next_member_alert_purge()
            await asyncio.sleep(max(0.0, (target - datetime.now(timezone.utc)).total_seconds()))
            cutoff = member_alert_purge_cutoff(target)
            if db is not None:
                await db.member_alerts.delete_many({"created_at": {"$lt": cutoff}})
                await db.alerts.delete_many({"created_at": {"$lt": cutoff.isoformat()}})
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Member alert retention cleanup failed")
            await asyncio.sleep(30)


app.include_router(api_router)


# --- Security: Trusted Host (prevent Host header attacks) ---
_trusted_hosts_env = os.environ.get("TRUSTED_HOSTS", "").strip()
_trusted_hosts = (
    [h.strip() for h in _trusted_hosts_env.split(",") if h.strip()]
    if _trusted_hosts_env
    else [
        "striklenz.com",
        "www.striklenz.com",
        "admin.striklenz.com",
        "localhost",
        "127.0.0.1",
        "[::1]",
        "testserver",
    ]
)
app.add_middleware(TrustedHostMiddleware, allowed_hosts=_trusted_hosts)

# --- Security: HTTP security headers ---
class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
        response.headers["Cross-Origin-Opener-Policy"] = "same-origin"
        response.headers["X-Permitted-Cross-Domain-Policies"] = "none"
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; "
            "base-uri 'self'; "
            "form-action 'self'; "
            "object-src 'none'; "
            "frame-ancestors 'none'; "
            "script-src 'self' 'unsafe-inline' https://static.cloudflareinsights.com; "
            "script-src-elem 'self' 'unsafe-inline' https://static.cloudflareinsights.com; "
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
            "font-src 'self' https://fonts.gstatic.com data:; "
            "img-src 'self' data: blob: https:; "
            "connect-src 'self' ws: wss: https:; "
            "worker-src 'self' blob:"
        )
        path = request.url.path
        if path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"
        # HSTS: enable only when served over HTTPS in production
        if os.environ.get('ENABLE_HSTS', 'true').lower() == 'true':
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        return response

app.add_middleware(SecurityHeadersMiddleware)

# --- Security: Simple in-memory rate limiter for sensitive endpoints ---
_rate_buckets: dict = defaultdict(deque)
_RATE_LIMITED_PREFIXES = (
    "/api/credentials",
    "/api/kite/generate-session",
    "/api/kite/refresh",
    "/api/kite/vault",
    "/api/kite/user/session",
    "/api/mode",
    "/api/telegram/huge-shift",
    "/api/auth/guest",
    "/api/auth/login",
    "/api/auth/remember-login",
    "/api/auth/change-password",
    "/api/errors",
)
_AUTH_STRICT_PREFIXES = (
    "/api/auth/login",
    "/api/auth/remember-login",
)
_RATE_LIMIT_MAX = int(os.environ.get('RATE_LIMIT_MAX', '20'))       # requests
_RATE_LIMIT_WINDOW = int(os.environ.get('RATE_LIMIT_WINDOW', '60')) # seconds
_AUTH_RATE_LIMIT_MAX = int(os.environ.get('AUTH_RATE_LIMIT_MAX', '8'))

class RateLimitMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        if request.method in ("POST", "DELETE") and any(path.startswith(p) for p in _RATE_LIMITED_PREFIXES):
            ip = request.client.host if request.client else "unknown"
            key = f"{ip}:{path}"
            now = time.time()
            bucket = _rate_buckets[key]
            while bucket and now - bucket[0] > _RATE_LIMIT_WINDOW:
                bucket.popleft()
            limit = _AUTH_RATE_LIMIT_MAX if any(path.startswith(p) for p in _AUTH_STRICT_PREFIXES) else _RATE_LIMIT_MAX
            if len(bucket) >= limit:
                return Response(
                    content='{"detail":"Too many requests. Please slow down."}',
                    status_code=429,
                    media_type="application/json",
                    headers={"Cache-Control": "no-store", "Retry-After": str(_RATE_LIMIT_WINDOW)},
                )
            bucket.append(now)
        return await call_next(request)

app.add_middleware(RateLimitMiddleware)

# --- CORS (restricted; wildcard only if explicitly set) ---
_cors_env = os.environ.get(
    "CORS_ORIGINS",
    "https://striklenz.com,https://www.striklenz.com,https://admin.striklenz.com,"
    "http://localhost:3000,http://127.0.0.1:3000",
).strip()
_cors_origins = [o.strip() for o in _cors_env.split(',') if o.strip()]
_cors_regex = os.environ.get('CORS_ORIGIN_REGEX', '').strip() or None
# Guard: a malformed CORS_ORIGIN_REGEX must never crash the server at boot.
if _cors_regex:
    try:
        re.compile(_cors_regex)
    except re.error as _re_err:
        print(f"[cors] Ignoring invalid CORS_ORIGIN_REGEX ({_re_err}); falling back to CORS_ORIGINS")
        _cors_regex = None
_allow_credentials = False  # This app authenticates via headers (X-Admin-Token /
# X-Guest-Token / Authorization) and uses NO cookies. Keeping credentials OFF is
# both correct and required: it lets us use a wildcard origin without clashing
# with the Emergent ingress, which injects `Access-Control-Allow-Origin: *`
# (wildcard + credentials is rejected by browsers).

app.add_middleware(
    CORSMiddleware,
    allow_credentials=_allow_credentials,
    allow_origins=_cors_origins,
    allow_origin_regex=_cors_regex,
    allow_methods=["GET", "POST", "DELETE", "PUT", "PATCH", "OPTIONS"],
    allow_headers=["*", "Authorization", "Content-Type", "X-Admin-Token", "X-Guest-Token"],
    expose_headers=["*"],
    max_age=600,
)

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)
if not logger.handlers:
    handler = logging.StreamHandler()
    handler.setFormatter(JsonLogFormatter())
    logger.addHandler(handler)
logger.propagate = False


straddle_sampler_task = None
poll_watchdog_task = None
journal_eod_task = None
member_alert_cleanup_task = None
market_intel_task = None
market_intel_stop = None
adr_task = None
adr_stop = None
event_calendar_task = None

@app.on_event("startup")
async def _startup():
    # Return immediately so uvicorn accepts /health /ready (Emergent/k8s probes).
    # Mongo, Kite, FII, GIFT/VIX continue in the background.
    asyncio.create_task(_boot())


async def _boot():
    # Bind HTTP first: assign tracker as soon as Mongo pings, then indexes/Kite
    # continue on another task so /health /auth/state never wait on create_index
    # or kite.instruments().
    global client, db, tracker
    try:
        mongo_url = os.environ["MONGO_URL"]
        db_name = os.environ["DB_NAME"]
    except KeyError:
        logger.exception("Failed to initialize MongoDB client: required environment setting is missing")
        return

    retry_delay = 2
    while True:
        candidate_client = None
        try:
            candidate_client = AsyncIOMotorClient(
                mongo_url,
                serverSelectionTimeoutMS=5000,
                connectTimeoutMS=5000,
            )
            candidate_db = candidate_client[db_name]
            await asyncio.wait_for(candidate_client.admin.command("ping"), timeout=6)
            client = candidate_client
            db = candidate_db
            break
        except Exception as e:
            if candidate_client is not None:
                candidate_client.close()
            logger.exception(
                "MongoDB startup connection failed; retrying in %s seconds: %s",
                retry_delay,
                e,
            )
            await asyncio.sleep(retry_delay)
            retry_delay = min(retry_delay * 2, 30)

    _notifier_boot.set_db(db)
    try:
        bind_error_log(db)
        install_logging_handler()
        from external_api_telemetry import bind as bind_external_api_telemetry, install_http_telemetry
        bind_external_api_telemetry(db)
        install_http_telemetry()
    except Exception:
        pass
    tracker = OITracker(db)
    asyncio.create_task(_boot_rest())


async def _ensure_mongo_indexes():
    try:
        await db.oi_snapshots.create_index(
            [("index", 1), ("expiry", 1), ("timestamp", 1)],
            unique=True,
            name="uniq_index_expiry_ts",
        )
        await db.oi_snapshots.create_index(
            [("index", 1), ("timestamp", 1)],
            name="idx_index_timestamp",
        )
        await db.oi_snapshots.create_index([("index", 1), ("created_at", 1)])
        await db.oi_snapshots.create_index("created_at")
        await db.alerts.create_index([("index", 1), ("created_at", -1)])
        await db.member_alerts.create_index([("user_id", 1), ("source_alert_id", 1)])
        await db.member_alerts.create_index("created_at")
        await db.member_alert_events.create_index(
            [("user_id", 1), ("created_at", -1)],
            name="idx_member_alert_events_user_created",
        )
        await db.member_alert_events.create_index(
            "expire_at",
            expireAfterSeconds=0,
            name="ttl_member_alert_events_expire",
        )
        await db.member_journal.create_index([("user_id", 1), ("date", 1)], unique=True)
        await db.billing_events.create_index("event_type", name="idx_billing_events_event_type")
        await db.straddle_samples.create_index([("index", 1), ("trade_date", 1), ("expiry", 1)])
        await db.straddle_samples.create_index([("index", 1), ("ts", 1)])
        await db.straddle_samples.create_index("created_at")
        await db.guest_sessions.create_index([("started_at", -1)])
        await db.guest_sessions.create_index("revoked_at")
        await db.guest_sessions.create_index("ip")
        await db.admin_remember_devices.create_index("ip")
        await db.admin_remember_devices.create_index("expires_at")
        await db.access_requests.create_index([("status", 1), ("created_at", -1)])
        await db.access_requests.create_index([("ip", 1), ("status", 1)])
        await db.blocked_ips.create_index("blocked_at")
        await db.user_kite.create_index("guest_token")
        await db.user_kite.create_index([("guest_name", 1), ("ip", 1)])
        try:
            import market_intel as _mi
            await _mi.ensure_indexes(db)
        except Exception as e:
            logger.warning("market intel indexes: %s", e)
        try:
            import adr as _adr
            await _adr.ensure_indexes(db)
            await _adr.seed_universe(db)
        except Exception as e:
            logger.warning("adr indexes: %s", e)
        await db.trade_journal.create_index("date", unique=True, name="uniq_journal_date")
        await db.cas_auto_log.create_index([("day", 1), ("at", -1)])
        await db.trade_cycles.create_index("cycle_id", unique=True, name="uniq_trade_cycle")
        await db.trade_cycles.create_index([("owner_id", 1), ("status", 1)])
        await db.trade_cycles.create_index([("owner_id", 1), ("entry_date", 1)])
        await db.trade_cycles.create_index([("owner_id", 1), ("exit_date", 1)])
        await db.error_logs.create_index([("created_at", -1)])
        await db.error_logs.create_index([("fingerprint", 1), ("created_at", -1)])
        await db.error_logs.create_index("source")
        await db.external_api_telemetry.create_index([("ts", -1)])
        await db.external_api_telemetry.create_index([("provider_id", 1), ("endpoint", 1), ("ts", -1)])
        await db.admin_ui_state.create_index("username")
    except Exception as e:
        logger.warning(f"index creation warn: {e}")


async def _seed_last_snapshots():
    try:
        wanted = list(DESK_IDS)
        extra = [i for i in (tracker.settings.get("enabled_indices") or []) if i not in wanted]
        for idx in wanted + extra[:2]:
            if idx in tracker.last_snapshot:
                continue
            try:
                doc = await asyncio.wait_for(
                    db.oi_snapshots.find_one(
                        {"index": idx},
                        sort=[("timestamp", -1)],
                        projection={"_id": 0},
                        maxTimeMS=800,
                    ),
                    timeout=1.2,
                )
            except TypeError:
                doc = await asyncio.wait_for(
                    db.oi_snapshots.find_one(
                        {"index": idx},
                        sort=[("timestamp", -1)],
                        projection={"_id": 0},
                    ),
                    timeout=1.2,
                )
            except Exception:
                doc = None
            if doc:
                tracker.last_snapshot[idx] = doc
        logger.info(
            "Seeded last_snapshot for %s indices from DB (session anchor %s)",
            len(tracker.last_snapshot),
            session_anchor_date().isoformat(),
        )
    except Exception as e:
        logger.warning(f"last_snapshot seed skipped: {e}")


async def _event_calendar_refresh_loop():
    """Check daily; the service refreshes only after a month or missing data."""
    while True:
        try:
            result = await ers.refresh_nse_event_calendar_if_due(db)
            if result.get("refreshed"):
                logger.info("NSE event calendar refreshed from the three-month Equity CSV export")
        except Exception as e:
            # Keep serving the last saved calendar and retry on the next daily check.
            logger.warning("NSE event calendar refresh failed; keeping saved events: %s", e)
        await asyncio.sleep(24 * 60 * 60)


async def _boot_rest():
    global straddle_sampler_task, poll_watchdog_task, journal_eod_task, member_alert_cleanup_task
    global market_intel_task, market_intel_stop, adr_task, adr_stop, event_calendar_task
    await _ensure_mongo_indexes()
    try:
        await asyncio.wait_for(tracker.load_credentials(), timeout=20)
    except Exception as e:
        logger.warning("load_credentials on startup: %s", e)
    try:
        await asyncio.wait_for(tracker.load_settings(), timeout=10)
    except Exception as e:
        logger.warning("load_settings on startup: %s", e)
    await tracker.start()
    try:
        import cas_bridge

        await asyncio.to_thread(cas_bridge.sync_credentials_from_tracker, tracker)
    except Exception as e:
        logger.warning("CAS engine attach on boot: %s", e)
    await _seed_last_snapshots()
    extra_tickers.attach_db(db)
    extra_tickers.attach_kite_provider(
        lambda: tracker.kite_service.kite if tracker and tracker.mode == "kite" and tracker.kite_service else None
    )
    await extra_tickers.start()
    fii_dii.attach_db(db)
    await fii_dii.start()
    straddle_sampler_task = asyncio.create_task(_straddle_sampler())
    poll_watchdog_task = asyncio.create_task(_market_day_poll_watchdog())
    journal_eod_task = asyncio.create_task(_journal_eod_lock_loop())
    member_alert_cleanup_task = asyncio.create_task(_member_alert_cleanup_loop())
    event_calendar_task = asyncio.create_task(_event_calendar_refresh_loop())
    try:
        import market_intel as _mi
        market_intel_stop = asyncio.Event()
        market_intel_task = asyncio.create_task(
            _mi.ingest_loop(lambda: db, lambda: tracker.settings if tracker else {}, market_intel_stop)
        )
    except Exception as e:
        logger.warning("market intel loop: %s", e)
    try:
        import adr as _adr
        adr_task, adr_stop = _adr.start_loop(lambda: db)
    except Exception as e:
        logger.warning("adr loop: %s", e)
    try:
        import global_markets as _global_markets
        import market_memory as _market_memory
        await _global_markets.ensure_indexes(db)
        await _market_memory.ensure_indexes(db)
    except Exception as e:
        logger.warning("global markets / market memory indexes: %s", e)
    logger.info(
        "Started browser-independent OI/straddle writers + market-day poll watchdog"
    )
    try:
        logger.info(f"OI Tracker started in {tracker.mode} mode")
    except Exception:
        pass


@app.on_event("shutdown")
async def _shutdown():
    try:
        if tracker:
            await tracker.stop()
    except Exception:
        pass
    try:
        await extra_tickers.stop()
    except Exception:
        pass
    try:
        await fii_dii.stop()
    except Exception:
        pass
    for task_name in (
        "straddle_sampler_task", "poll_watchdog_task", "journal_eod_task",
        "member_alert_cleanup_task", "market_intel_task", "adr_task",
        "event_calendar_task",
    ):
        if task_name == "market_intel_task" and market_intel_stop:
            market_intel_stop.set()
        if task_name == "adr_task" and adr_stop:
            adr_stop.set()
        task = globals().get(task_name)
        if task:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
            except Exception:
                pass
    try:
        if client:
            client.close()
    except Exception:
        pass
