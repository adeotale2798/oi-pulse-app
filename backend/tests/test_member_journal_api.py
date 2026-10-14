import asyncio
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

import server


class MemberJournalCursor:
    def __init__(self, rows):
        self.rows = rows

    async def to_list(self, length):
        return self.rows[:length]


class MemberJournalCollection:
    def __init__(self, rows):
        self.rows = rows
        self.query = None

    def find(self, query, projection=None):
        self.query = query
        date_range = query["date"]
        matches = [
            {key: value for key, value in row.items() if key not in {"_id", "user_id"}}
            for row in self.rows
            if row["user_id"] == query["user_id"]
            and date_range["$gte"] <= row["date"] < date_range["$lt"]
        ]
        return MemberJournalCursor(matches)


class MemberJournalDayCollection:
    def __init__(self, record):
        self.record = record
        self.query = None
        self.projection = None

    async def find_one(self, query, projection):
        self.query = query
        self.projection = projection
        if query["user_id"] != self.record["user_id"]:
            return None
        return {key: value for key, value in self.record.items() if key not in {"_id", "user_id"}}


def test_member_journal_month_returns_only_authenticated_members_entries(monkeypatch):
    collection = MemberJournalCollection([
        {
            "_id": "one", "user_id": "member-one", "date": "2026-10-05",
            "notes": "private", "booked_pnl": 1250, "exited_count": 1,
            "trade_count": 1, "win_trades": 1,
        },
        {"_id": "two", "user_id": "member-two", "date": "2026-10-06", "notes": "not mine"},
        {"_id": "old", "user_id": "member-one", "date": "2026-09-30", "notes": "other month"},
    ])
    monkeypatch.setattr(server, "db", SimpleNamespace(member_journal=collection))

    requested_features = []

    async def member_context(_request, feature):
        requested_features.append(feature)
        return {"member_id": "member-one", "member": {}}, {}, "pro"

    monkeypatch.setattr(server, "_member_context", member_context)
    result = asyncio.run(server.member_journal_month(year=2026, month=10, request=None))

    assert result["year"] == 2026
    assert result["month"] == 10
    assert result["days"][0]["date"] == "2026-10-05"
    assert result["days"][0]["notes"] == "private"
    assert result["days"][0]["booked_pnl"] == 1250
    assert result["stats"]["net_pnl"] == 1250
    assert result["stats"]["trade_wins"] == 1
    assert collection.query["user_id"] == "member-one"
    assert requested_features == ["trade_journal"]


def test_member_journal_day_cannot_read_another_members_record(monkeypatch):
    collection = MemberJournalDayCollection({
        "_id": "other-private-entry",
        "user_id": "member-two",
        "date": "2026-10-05",
        "notes": "must stay private",
    })
    monkeypatch.setattr(server, "db", SimpleNamespace(member_journal=collection))

    async def member_context(_request, feature):
        assert feature == "trade_journal"
        return {"member_id": "member-one", "member": {}}, {}, "pro"

    monkeypatch.setattr(server, "_member_context", member_context)
    result = asyncio.run(server.member_journal_get(day="2026-10-05", request=None))

    assert collection.query == {"user_id": "member-one", "date": "2026-10-05"}
    assert result["empty"] is True
    assert "must stay private" not in repr(result)


def test_member_journal_month_rejects_invalid_month(monkeypatch):
    async def member_context(_request, _feature):
        return {"member_id": "member-one", "member": {}}, {}, "pro"

    monkeypatch.setattr(server, "_member_context", member_context)

    with pytest.raises(HTTPException) as error:
        asyncio.run(server.member_journal_month(year=2026, month=13, request=None))

    assert error.value.status_code == 400


class MemberJournalWriteCollection:
    def __init__(self, row=None):
        self.row = row
        self.update = None

    async def find_one(self, query):
        assert query["user_id"] == "member-one"
        return self.row

    async def update_one(self, query, update, upsert=False):
        self.update = update
        self.row = {**(self.row or update.get("$setOnInsert", {})), **update["$set"]}


def test_member_position_snapshot_persists_aggregates_without_legs(monkeypatch):
    collection = MemberJournalWriteCollection({
        "user_id": "member-one",
        "date": "2026-10-13",
        "notes": "my private notes",
    })
    monkeypatch.setattr(server, "db", SimpleNamespace(member_journal=collection))
    fixed_now = datetime(2026, 10, 13, 10, 0, tzinfo=timezone(timedelta(hours=5, minutes=30)))
    monkeypatch.setattr(server, "now_ist", lambda: fixed_now)
    monkeypatch.setattr(
        server.journal,
        "snapshot_from_positions",
        lambda _payload, date: {
            "date": date,
            "trading_date": date,
            "booked_pnl": 1250.5,
            "pnl_exited": 1250.5,
            "pnl_open": -30,
            "pnl_total": 1220.5,
            "open_count": 1,
            "exited_count": 1,
            "partial_count": 0,
            "trade_count": 2,
            "win_trades": 1,
            "loss_trades": 0,
            "booked_index_pnl": {"NIFTY": 1250.5},
            "index_pnl": {"NIFTY": 1220.5},
            "legs": [{"tradingsymbol": "PRIVATE-DETAIL", "realised": 1250.5}],
            "snapshot_at": "2026-10-13T10:00:00+05:30",
        },
    )

    asyncio.run(server._snapshot_member_trade_journal("member-one", {"positions": []}))

    assert collection.row["user_id"] == "member-one"
    assert collection.row["notes"] == "my private notes"
    assert collection.row["booked_pnl"] == 1250.5
    assert collection.row["win_trades"] == 1
    assert collection.row["booked_index_pnl"] == {"NIFTY": 1250.5}
    assert "legs" not in collection.row
    assert "PRIVATE-DETAIL" not in repr(collection.row)
    assert "legs" not in collection.update["$set"]
