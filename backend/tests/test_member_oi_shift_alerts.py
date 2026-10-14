import asyncio
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

import server


class MemberAlertEventCollection:
    def __init__(self):
        self.rows = {}
        self.query = None
        self.update = None

    async def update_one(self, query, update, upsert=False):
        self.query = query
        self.update = update
        if query["_id"] not in self.rows:
            self.rows[query["_id"]] = update["$setOnInsert"]

    async def find_one(self, query, projection=None):
        row = self.rows.get(query["_id"])
        if row is None:
            return None
        return {
            key: value for key, value in row.items()
            if not projection or projection.get(key) != 0 or projection.get(key) == 1
        }

    def find(self, query, projection=None):
        self.query = query
        return MemberAlertEventCursor(
            [
                {
                    key: value for key, value in row.items()
                    if not projection or projection.get(key) != 0 or projection.get(key) == 1
                }
                for row in self.rows.values()
                if row.get("user_id") == query.get("user_id")
                and row.get("index") in query["index"]["$in"]
            ]
        )


class MemberAlertEventCursor:
    def __init__(self, rows):
        self.rows = rows

    def sort(self, *_args):
        self.rows.sort(key=lambda row: row.get("created_at") or "", reverse=True)
        return self

    async def to_list(self, length):
        return self.rows[:length]


class MemberAlertCollection:
    def find(self, _query, _projection=None):
        return MemberAlertEventCursor([])

def _payload(**overrides):
    return {
        "id": "NIFTY:3:CE:build:1234",
        "index": "NIFTY",
        "window": 3,
        "side": "CE",
        "value": 125000,
        "atm": 25000,
        "price": 25010.5,
        "contributing": [
            {"strike": 25000, "ce_delta": 70000, "pe_delta": -10000},
        ],
        **overrides,
    }


def _configure_member_context(monkeypatch, *, preferences=None, permissions=True):
    requested_features = []
    member = {
        "member_id": "member-123",
        "member": {"preferences": preferences or {}},
    }

    async def member_context(_request, feature):
        requested_features.append(feature)
        if feature == "oi_shift_alerts" and not permissions:
            raise HTTPException(403, "OI shift alerts require Pro")
        return member, {"preference_defaults": {}}, "pro"

    monkeypatch.setattr(server, "_member_context", member_context)
    return requested_features


def test_member_oi_shift_alert_is_member_scoped_and_idempotent(monkeypatch):
    events = MemberAlertEventCollection()
    monkeypatch.setattr(server, "db", SimpleNamespace(member_alert_events=events))
    features = _configure_member_context(
        monkeypatch,
        preferences={
            "alert_indices": ["NIFTY"],
            "oi_shift_threshold_contracts": 100000,
            "alert_types": {"oi_shift": True},
        },
    )

    first = asyncio.run(server.member_oi_shift_alert_save(_payload(), request=None))
    repeated = asyncio.run(server.member_oi_shift_alert_save(_payload(), request=None))

    saved = first["alert"]
    assert saved["type"] == "oi_shift"
    assert "user_id" not in saved
    assert saved["index"] == "NIFTY"
    assert saved["direction"] == "build"
    assert saved["seen"] is False
    assert saved["strikes"] == _payload()["contributing"]
    assert repeated["alert"]["alert_id"] == saved["alert_id"]
    assert "_id" not in saved
    assert "user_id" not in saved
    assert "expire_at" not in saved
    assert len(events.rows) == 1
    assert events.query == {"_id": events.update["$setOnInsert"]["_id"]}
    stored = events.rows[events.update["$setOnInsert"]["_id"]]
    assert stored["user_id"] == "member-123"
    assert isinstance(stored["expire_at"], datetime)
    assert stored["expire_at"].tzinfo == timezone.utc
    assert features == ["alerts", "oi_shift_alerts", "alerts", "oi_shift_alerts"]


@pytest.mark.parametrize(
    ("preferences", "payload", "status"),
    [
        (
            {"alert_indices": ["NIFTY"], "alert_types": {"oi_shift": False}},
            _payload(),
            403,
        ),
        (
            {"alert_indices": ["SENSEX"], "alert_types": {"oi_shift": True}},
            _payload(),
            400,
        ),
        (
            {
                "alert_indices": ["NIFTY"],
                "oi_shift_threshold_contracts": 200000,
                "alert_types": {"oi_shift": True},
            },
            _payload(),
            400,
        ),
        (
            {"alert_indices": ["NIFTY"], "alert_types": {"oi_shift": True}},
            _payload(value=float("nan")),
            400,
        ),
    ],
)
def test_member_oi_shift_alert_rejects_disabled_or_invalid_events(
    monkeypatch, preferences, payload, status
):
    events = MemberAlertEventCollection()
    monkeypatch.setattr(server, "db", SimpleNamespace(member_alert_events=events))
    _configure_member_context(monkeypatch, preferences=preferences)

    with pytest.raises(HTTPException) as error:
        asyncio.run(server.member_oi_shift_alert_save(payload, request=None))

    assert error.value.status_code == status
    assert events.rows == {}


def test_member_oi_shift_alert_requires_entitlement(monkeypatch):
    events = MemberAlertEventCollection()
    monkeypatch.setattr(server, "db", SimpleNamespace(member_alert_events=events))
    features = _configure_member_context(monkeypatch, permissions=False)

    with pytest.raises(HTTPException) as error:
        asyncio.run(server.member_oi_shift_alert_save(_payload(), request=None))

    assert error.value.status_code == 403
    assert events.rows == {}
    assert features == ["alerts", "oi_shift_alerts"]


def test_member_alert_inbox_queries_only_the_authenticated_members_events(monkeypatch):
    events = MemberAlertEventCollection()
    own_event = {
        "alert_id": "own-alert",
        "user_id": "member-123",
        "type": "oi_shift",
        "index": "NIFTY",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "value": 125000,
        "side": "CE",
        "window": 3,
        "atm": 25000,
        "direction": "build",
    }
    other_event = {**own_event, "alert_id": "other-alert", "user_id": "member-456"}
    events.rows = {own_event["alert_id"]: own_event, other_event["alert_id"]: other_event}
    member_alerts = MemberAlertCollection()
    monkeypatch.setattr(server, "db", SimpleNamespace(
        alerts=MemberAlertCollection(),
        member_alert_events=events,
        member_alerts=member_alerts,
    ))
    monkeypatch.setattr(server, "tracker", None)
    monkeypatch.setattr(server, "_is_admin_request", lambda _request: asyncio.sleep(0, result=False))
    monkeypatch.setattr(
        server,
        "_member_session_from_request",
        lambda _request: asyncio.sleep(0, result={
            "member_id": "member-123",
            "member": {
                "preferences": {
                    "alert_indices": ["NIFTY"],
                    "oi_shift_threshold_contracts": 100000,
                    "alert_types": {"oi_shift": True},
                },
            },
        }),
    )

    async def member_context(_request, _feature):
        return {
            "member_id": "member-123",
            "member": {
                "preferences": {
                    "alert_indices": ["NIFTY"],
                    "oi_shift_threshold_contracts": 100000,
                    "alert_types": {"oi_shift": True},
                },
            },
        }, {"preference_defaults": {}}, "pro"

    monkeypatch.setattr(server, "_member_context", member_context)
    monkeypatch.setattr(server, "session_anchor_date", lambda: datetime.now(timezone.utc).date())
    monkeypatch.setattr(
        server,
        "session_window_utc",
        lambda _anchor: (datetime(2026, 10, 14, tzinfo=timezone.utc), None),
    )

    result = asyncio.run(server.get_alerts(request=None, limit=50))

    assert [alert["alert_id"] for alert in result["alerts"]] == ["own-alert"]
    assert result["alerts"][0]["type"] == "oi_shift"
    assert events.query["user_id"] == "member-123"
