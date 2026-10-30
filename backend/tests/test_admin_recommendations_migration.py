import asyncio
from types import SimpleNamespace

import holiday_calendar
import index_registry

from oi_tracker import ADMIN_RECOMMENDATIONS_MIGRATION_KEY, OITracker


class Settings:
    def __init__(self, document):
        self.document = document
        self.updates = []

    async def find_one(self, _query, maxTimeMS=None):
        return dict(self.document)

    async def update_one(self, query, update, upsert=False):
        self.updates.append((query, update, upsert))
        self.document.update(update["$set"])


def _tracker_with_noop_bootstrap(monkeypatch, db):
    async def no_op(*_args):
        return None

    monkeypatch.setattr(index_registry, "bootstrap_registry", no_op)
    monkeypatch.setattr(holiday_calendar, "load_uploaded_holidays", no_op)
    tracker = OITracker(db)
    tracker._apply_market_hours = lambda: None
    tracker._refresh_alert_indices_for_today = lambda: None
    tracker._apply_mcx_desk_flag = lambda: None
    return tracker


def test_admin_recommendations_restore_once_and_keep_later_admin_choice(monkeypatch):
    settings = Settings({
        "_id": "alerts",
        "admin_visible_pages": ["oi-change", "positions"],
        "show_suggestion": False,
    })
    db = SimpleNamespace(settings=settings)

    first_tracker = _tracker_with_noop_bootstrap(monkeypatch, db)
    asyncio.run(first_tracker.load_settings())

    assert "sell-candidates" in first_tracker.settings["admin_visible_pages"]
    assert first_tracker.settings["show_suggestion"] is True
    assert settings.document[ADMIN_RECOMMENDATIONS_MIGRATION_KEY] is True
    assert ADMIN_RECOMMENDATIONS_MIGRATION_KEY not in first_tracker.settings

    settings.document["admin_visible_pages"] = ["oi-change"]
    settings.document["show_suggestion"] = False
    second_tracker = _tracker_with_noop_bootstrap(monkeypatch, db)
    asyncio.run(second_tracker.load_settings())
    asyncio.run(second_tracker.reload_settings_from_db())

    assert second_tracker.settings["admin_visible_pages"] == ["oi-change"]
    assert second_tracker.settings["show_suggestion"] is False
    assert ADMIN_RECOMMENDATIONS_MIGRATION_KEY not in second_tracker.settings
