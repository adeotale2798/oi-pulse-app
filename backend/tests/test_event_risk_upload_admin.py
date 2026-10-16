from copy import deepcopy
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from fastapi import Request
from fastapi.testclient import TestClient

import server


class MemoryCollection:
    def __init__(self, rows):
        self.rows = rows

    async def count_documents(self, query):
        return sum(
            all(row.get(key) == value for key, value in query.items())
            for row in self.rows
        )


class MemorySettings:
    def __init__(self, rows):
        self.rows = rows

    async def find_one(self, query, **_kwargs):
        return self.rows.get(query["_id"])

    async def update_one(self, query, update, upsert=False):
        doc = self.rows.setdefault(query["_id"], {})
        doc.update(update.get("$set", {}))


def test_upload_freshness_is_admin_only_and_each_category_can_be_confirmed(monkeypatch):
    old_upload = (datetime.now(timezone.utc) - timedelta(days=400)).isoformat()
    metadata_ids = {
        "nifty50": "constituents_meta_NIFTY",
        "banknifty": "constituents_meta_BANKNIFTY",
        "sensex": "constituents_meta_SENSEX",
        "events": "nse_events_meta",
        "holidays": "nse_holidays_meta",
    }
    settings = MemorySettings({
        meta_id: {
            "uploaded_at": old_upload,
            "source_filename": f"{key}.csv",
            "row_count": 1,
        }
        for key, meta_id in metadata_ids.items()
    })
    index_rows = [
        {"index": "NIFTY", "symbol": "NIFTY"},
        {"index": "BANKNIFTY", "symbol": "BANKNIFTY"},
        {"index": "SENSEX", "symbol": "500180"},
    ]
    event_rows = [{"symbol": "ABC"}]
    holiday_rows = [{"date": "2026-12-25"}]
    db = SimpleNamespace(
        index_constituents=MemoryCollection(index_rows),
        nse_events=MemoryCollection(event_rows),
        nse_holidays=MemoryCollection(holiday_rows),
        settings=settings,
    )
    original_rows = deepcopy((index_rows, event_rows, holiday_rows))
    monkeypatch.setattr(server, "db", db)

    async def no_events(_db, _index):
        return [], {"constituent_count": 0, "constituents_with_event": 0}

    monkeypatch.setattr(server.ers, "fetch_events_for_index", no_events)
    client = TestClient(server.app)

    assert client.get("/api/upload/meta").status_code == 401
    assert client.post("/api/admin/upload/reuse/nifty50").status_code == 401
    events_response = client.get("/api/events/SENSEX")
    assert events_response.status_code == 200
    assert "upload_meta" not in events_response.json()
    assert events_response.json()["join"] is None

    async def allow_admin(_request: Request):
        return True

    server.app.dependency_overrides[server.require_admin] = allow_admin
    async def is_admin_request(_request: Request):
        return True

    monkeypatch.setattr(server, "_is_admin_request", is_admin_request)
    try:
        admin_events_response = client.get("/api/events/SENSEX")
        assert admin_events_response.status_code == 200
        assert admin_events_response.json()["join"]["constituent_count"] == 0

        stale_meta = client.get("/api/upload/meta")
        assert stale_meta.status_code == 200
        assert all(row["stale"] for row in stale_meta.json().values())

        for upload_type in metadata_ids:
            response = client.post(f"/api/admin/upload/reuse/{upload_type}")
            assert response.status_code == 200
            assert response.json()["row_count"] == 1
            assert response.json()["confirmed_at"]

        fresh_meta = client.get("/api/upload/meta")
        assert fresh_meta.status_code == 200
        for key, row in fresh_meta.json().items():
            assert row["stale"] is False
            assert row["uploaded_at"] == old_upload
            assert row["confirmed_at"]

        assert (index_rows, event_rows, holiday_rows) == original_rows
        assert client.post("/api/admin/upload/reuse/unknown").status_code == 400
        db.index_constituents.rows = [
            row for row in index_rows if row["index"] != "SENSEX"
        ]
        assert client.post("/api/admin/upload/reuse/sensex").status_code == 409
    finally:
        server.app.dependency_overrides.pop(server.require_admin, None)
