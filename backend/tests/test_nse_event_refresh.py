import asyncio
from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace

from fastapi import Request
from fastapi.testclient import TestClient

import event_risk_service as ers
import server


NSE_CSV = (
    b'"SYMBOL \n","COMPANY \n","PURPOSE \n","DETAILS \n","DATE \n"\n'
    b'"ABC","ABC Limited","Financial Results","Quarterly results","17-Oct-2026"\n'
)


class MemoryCollection:
    def __init__(self, rows=None):
        self.rows = list(rows or [])
        self.deleted = False

    async def delete_many(self, _query):
        self.deleted = True
        self.rows.clear()

    async def insert_many(self, rows):
        self.rows.extend(rows)

    async def count_documents(self, _query):
        return len(self.rows)


class MemorySettings:
    def __init__(self, rows=None):
        self.rows = dict(rows or {})

    async def find_one(self, query):
        return self.rows.get(query["_id"])

    async def update_one(self, query, update, upsert=False):
        self.rows.setdefault(query["_id"], {}).update(update.get("$set", {}))


def _db(events=None, meta=None):
    return SimpleNamespace(
        nse_events=MemoryCollection(events),
        settings=MemorySettings({"nse_events_meta": meta} if meta else {}),
    )


def test_fetch_downloads_nse_three_month_equity_csv(monkeypatch):
    calls = {}

    class Response:
        def __init__(self, content=b"", headers=None):
            self.content = content
            self.headers = headers or {}

        def raise_for_status(self):
            pass

    class Client:
        def __init__(self, timeout, headers, follow_redirects):
            calls["timeout"] = timeout
            calls["headers"] = headers
            calls["follow_redirects"] = follow_redirects

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        async def get(self, url, params=None):
            calls.setdefault("requests", []).append((url, params))
            if params is None:
                return Response()
            return Response(NSE_CSV, {"content-type": "text/csv"})

    import httpx

    monkeypatch.setattr(httpx, "AsyncClient", Client)
    result = asyncio.run(ers.fetch_nse_event_calendar_csv(today=date(2027, 1, 31)))

    assert result == NSE_CSV
    assert calls["follow_redirects"] is True
    assert calls["requests"] == [
        (
            "https://www.nseindia.com/companies-listing/corporate-filings-event-calendar",
            None,
        ),
        (
            ers.NSE_EVENT_API_URL,
            {
                "index": "equities",
                "from_date": "31-01-2027",
                "to_date": "30-04-2027",
                "csv": "true",
            },
        ),
    ]
    assert calls["headers"]["Accept"].startswith("text/csv")
    assert "Referer" in calls["headers"]


def test_refresh_replaces_calendar_after_full_payload_validates(monkeypatch):
    db = _db(events=[{"id": "old", "symbol": "OLD"}])

    async def fetch(today=None):
        return NSE_CSV

    monkeypatch.setattr(ers, "fetch_nse_event_calendar_csv", fetch)
    result = asyncio.run(ers.refresh_nse_event_calendar(db))

    assert result["refreshed"] is True
    assert result["rows_saved"] == 1
    assert db.nse_events.deleted is True
    assert db.nse_events.rows[0]["symbol"] == "ABC"
    assert db.settings.rows["nse_events_meta"]["source_filename"].startswith("NSE Download:")


def test_refresh_parse_failure_preserves_last_good_events(monkeypatch):
    existing = [{"id": "last-good", "symbol": "OLD"}]
    db = _db(events=existing)

    async def fetch(today=None):
        return b'"SYMBOL","COMPANY","PURPOSE"\n"ABC","ABC Limited","Results"\n'

    monkeypatch.setattr(ers, "fetch_nse_event_calendar_csv", fetch)
    try:
        asyncio.run(ers.refresh_nse_event_calendar(db))
    except ValueError as exc:
        assert "validation failed" in str(exc)
    else:
        raise AssertionError("Malformed NSE data should fail validation.")

    assert db.nse_events.rows == existing
    assert db.nse_events.deleted is False


def test_refresh_fetch_failure_preserves_last_good_events(monkeypatch):
    existing = [{"id": "last-good", "symbol": "OLD"}]
    db = _db(events=existing)

    async def fetch(today=None):
        raise RuntimeError("upstream unavailable")

    monkeypatch.setattr(ers, "fetch_nse_event_calendar_csv", fetch)
    try:
        asyncio.run(ers.refresh_nse_event_calendar(db))
    except RuntimeError as exc:
        assert str(exc) == "upstream unavailable"
    else:
        raise AssertionError("Fetch failure should be surfaced.")

    assert db.nse_events.rows == existing
    assert db.nse_events.deleted is False


def test_refresh_check_skips_recent_data_and_refreshes_old_data(monkeypatch):
    recent = (datetime.now(timezone.utc) - timedelta(days=10)).isoformat()
    db = _db(events=[{"id": "current"}], meta={"uploaded_at": recent, "confirmed_at": recent})

    async def unexpected_fetch(today=None):
        raise AssertionError("Fresh data should not trigger a request.")

    monkeypatch.setattr(ers, "fetch_nse_event_calendar_csv", unexpected_fetch)
    skipped = asyncio.run(ers.refresh_nse_event_calendar_if_due(db))
    assert skipped == {"refreshed": False, "reason": "calendar is current"}

    old = (datetime.now(timezone.utc) - timedelta(days=31)).isoformat()
    db.settings.rows["nse_events_meta"]["uploaded_at"] = old

    async def fetch(today=None):
        return NSE_CSV

    monkeypatch.setattr(ers, "fetch_nse_event_calendar_csv", fetch)
    refreshed = asyncio.run(ers.refresh_nse_event_calendar_if_due(db))
    assert refreshed["refreshed"] is True


def test_admin_reuse_confirmation_does_not_delay_automatic_refresh(monkeypatch):
    uploaded_at = (datetime.now(timezone.utc) - timedelta(days=31)).isoformat()
    confirmed_at = datetime.now(timezone.utc).isoformat()
    db = _db(
        events=[{"id": "current"}],
        meta={"uploaded_at": uploaded_at, "confirmed_at": confirmed_at},
    )

    async def fetch(today=None):
        return NSE_CSV

    monkeypatch.setattr(ers, "fetch_nse_event_calendar_csv", fetch)
    result = asyncio.run(ers.refresh_nse_event_calendar_if_due(db))

    assert result["refreshed"] is True


def test_manual_nse_refresh_is_admin_only_and_returns_saved_row_count(monkeypatch):
    client = TestClient(server.app)
    assert client.post("/api/admin/upload/events/refresh").status_code == 401

    async def refresh(db):
        assert db is server.db
        return {"refreshed": True, "rows_saved": 428, "uploaded_at": "2026-10-17T00:00:00+00:00"}

    monkeypatch.setattr(server.ers, "refresh_nse_event_calendar", refresh)

    async def allow_admin(_request: Request):
        return True

    server.app.dependency_overrides[server.require_admin] = allow_admin
    try:
        response = client.post("/api/admin/upload/events/refresh")
        assert response.status_code == 200
        assert response.json() == {
            "ok": True,
            "rows_saved": 428,
            "uploaded_at": "2026-10-17T00:00:00+00:00",
            "source_filename": "NSE Download: Equity events (Next 3 Months)",
        }
    finally:
        server.app.dependency_overrides.pop(server.require_admin, None)


def test_manual_nse_refresh_failure_is_explicit(monkeypatch):
    client = TestClient(server.app)

    async def refresh(_db):
        import httpx
        raise httpx.ConnectError("NSE unavailable")

    monkeypatch.setattr(server.ers, "refresh_nse_event_calendar", refresh)

    async def allow_admin(_request: Request):
        return True

    server.app.dependency_overrides[server.require_admin] = allow_admin
    try:
        response = client.post("/api/admin/upload/events/refresh")
        assert response.status_code == 502
        assert response.json()["detail"] == "Could not refresh events from NSE; saved events were kept."
    finally:
        server.app.dependency_overrides.pop(server.require_admin, None)


def test_manual_csv_upload_remains_available_after_nse_fetch_failure(monkeypatch):
    db = _db(events=[{"id": "last-good", "symbol": "OLD"}])
    monkeypatch.setattr(server, "db", db)

    async def refresh(_db):
        import httpx
        raise httpx.ConnectError("NSE unavailable")

    monkeypatch.setattr(server.ers, "refresh_nse_event_calendar", refresh)

    async def allow_admin(_request: Request):
        return True

    server.app.dependency_overrides[server.require_admin] = allow_admin
    try:
        client = TestClient(server.app)
        failed_refresh = client.post("/api/admin/upload/events/refresh")
        assert failed_refresh.status_code == 502

        manual_upload = client.post(
            "/api/admin/upload/events",
            files={
                "file": (
                    "manual.csv",
                    b"SYMBOL,COMPANY,PURPOSE,DATE\nABC,ABC Limited,Financial Results,17-Oct-2026\n",
                    "text/csv",
                )
            },
        )
        assert manual_upload.status_code == 200
        assert manual_upload.json()["rows_saved"] == 1
        assert db.nse_events.rows[0]["symbol"] == "ABC"
    finally:
        server.app.dependency_overrides.pop(server.require_admin, None)
