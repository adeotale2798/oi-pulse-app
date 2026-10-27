import asyncio
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from starlette.websockets import WebSocketDisconnect

import market_hours
import server
from oi_tracker import OITracker


def _snapshot(timestamp):
    return {
        "index": "NIFTY",
        "timestamp": timestamp,
        "price": 25000,
        "atm": 25000,
        "expiry": "2026-10-29",
        "ce_ltp": 40,
        "pe_ltp": 45,
        "premium": 85,
        "strikes": [],
    }


def _tracker(snapshot):
    return SimpleNamespace(
        settings={"straddle_poll_interval_seconds": 15},
        last_straddle_quote={},
        last_snapshot={"NIFTY": snapshot} if snapshot else {},
        selected_expiry={},
        effective_oi_poll_seconds=lambda: 15,
        _get_service=lambda: None,
    )


def test_straddle_snapshot_freshness_rejects_stale_future_and_missing_timestamps():
    now = datetime.now(timezone.utc)
    assert server._is_recent_straddle_sample(
        _snapshot((now - timedelta(seconds=16)).isoformat()),
        max_age_seconds=17,
        now=now,
    )
    assert not server._is_recent_straddle_sample(
        _snapshot((now - timedelta(seconds=18)).isoformat()),
        max_age_seconds=17,
        now=now,
    )
    assert not server._is_recent_straddle_sample(
        _snapshot((now + timedelta(seconds=1)).isoformat()),
        max_age_seconds=17,
        now=now,
    )
    assert not server._is_recent_straddle_sample(
        {"price": 25000},
        max_age_seconds=17,
        now=now,
    )


def test_straddle_tick_rejects_old_oi_snapshot_instead_of_stamping_it_current(monkeypatch):
    stale = _snapshot((datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat())
    monkeypatch.setattr(server, "tracker", _tracker(stale))

    async def no_persist(*_args, **_kwargs):
        raise AssertionError("stale fallback must not be persisted as a live sample")

    monkeypatch.setattr(server, "_persist_straddle_sample", no_persist)
    with pytest.raises(HTTPException) as exc:
        asyncio.run(server.get_straddle_tick("NIFTY"))

    assert exc.value.status_code == 503
    assert "fresh data" in exc.value.detail.lower()


def test_straddle_tick_preserves_timestamp_of_fresh_oi_fallback(monkeypatch):
    timestamp = datetime.now(timezone.utc).isoformat()
    snapshot = _snapshot(timestamp)
    monkeypatch.setattr(server, "tracker", _tracker(snapshot))

    async def no_persist(*_args, **_kwargs):
        return None

    monkeypatch.setattr(server, "_persist_straddle_sample", no_persist)
    result = asyncio.run(server.get_straddle_tick("NIFTY"))

    assert result["ts"] == timestamp


def test_tracker_does_not_store_the_same_fallback_snapshot_repeatedly():
    class StraddleCollection:
        def __init__(self):
            self.inserted = []

        async def insert_one(self, row):
            self.inserted.append(row)

    collection = StraddleCollection()
    tracker = OITracker(SimpleNamespace(straddle_samples=collection))
    timestamp = datetime.now(timezone.utc).isoformat()
    tracker.last_straddle_quote["NIFTY"] = {
        "ts": timestamp,
        "premium": 85,
        "underlying": 25000,
        "atm": 25000,
    }

    asyncio.run(tracker._store_straddle_sample("NIFTY", _snapshot(timestamp)))

    assert collection.inserted == []


@pytest.mark.parametrize("age_seconds, expected_error", [(0, False), (300, True)])
def test_straddle_websocket_does_not_refresh_timestamp_for_stale_snapshot(
    monkeypatch,
    age_seconds,
    expected_error,
):
    now = datetime.now(timezone.utc)
    timestamp = (now - timedelta(seconds=age_seconds)).isoformat()
    snapshot = _snapshot(timestamp)
    monkeypatch.setattr(server, "tracker", _tracker(snapshot))
    monkeypatch.setattr(market_hours, "is_market_open", lambda _now: True)

    async def no_persist(*_args, **_kwargs):
        return None

    async def disconnect_after_first_message(_seconds):
        raise WebSocketDisconnect(code=1000)

    monkeypatch.setattr(server, "_persist_straddle_sample", no_persist)
    monkeypatch.setattr(server.asyncio, "sleep", disconnect_after_first_message)

    class FakeWebSocket:
        scope = {"query_string": b""}

        def __init__(self):
            self.messages = []
            self.closed = False

        async def accept(self):
            return None

        async def send_json(self, payload):
            self.messages.append(payload)

        async def close(self, **_kwargs):
            self.closed = True

    websocket = FakeWebSocket()
    asyncio.run(server.ws_straddle(websocket, "NIFTY"))

    assert websocket.closed
    if expected_error:
        assert websocket.messages == [{"error": "no_snapshot"}]
    else:
        assert websocket.messages[0]["ts"] == timestamp
        assert websocket.messages[0]["premium"] == 85
