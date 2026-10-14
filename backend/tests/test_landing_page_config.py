import asyncio
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

import server


def test_landing_page_defaults_hide_broker_directory_but_keep_other_sections():
    config = server._normalize_landing_page_config()

    assert config["sections"]["broker_connect"] is False
    assert config["sections"]["pricing"] is True
    assert config["plan_more_info_enabled"] is True
    assert len(config["feature_cards"]) == len(server.LANDING_PAGE_FEATURE_CARDS)
    assert config["broker_ids"] == [broker["id"] for broker in server.DEFAULT_BROKERS]


def test_landing_page_config_only_accepts_known_visibility_ids():
    config = server._normalize_landing_page_config({
        "sections": {
            "broker_connect": True,
            "pricing": False,
            "unknown": True,
        },
        "feature_cards": ["desk_ai", "unknown", {"bad": "value"}],
        "broker_ids": ["zerodha", "unknown", ["invalid"]],
    })

    assert config["sections"]["broker_connect"] is True
    assert config["sections"]["pricing"] is False
    assert "unknown" not in config["sections"]
    assert config["feature_cards"] == ["desk_ai"]
    assert config["broker_ids"] == ["zerodha"]

def test_landing_page_more_info_setting_requires_explicit_true():
    assert server._normalize_landing_page_config({
        "plan_more_info_enabled": False,
    })["plan_more_info_enabled"] is False
    assert server._normalize_landing_page_config({
        "plan_more_info_enabled": "false",
    })["plan_more_info_enabled"] is False


def test_landing_page_replaces_legacy_market_structure_card_with_global_markets():
    config = server._normalize_landing_page_config({
        "feature_cards": ["option_chain", "market_structure"],
    })

    assert config["feature_cards"] == ["option_chain", "global_markets"]


def test_landing_page_replaces_old_oi_distribution_tile_with_straddle_and_events():
    config = server._normalize_landing_page_config({
        "feature_cards": ["option_chain", "oi_distribution", "desk_ai"],
    })

    assert config["feature_cards"] == [
        "option_chain",
        "straddle",
        "market_events",
        "desk_ai",
    ]


def test_landing_page_copy_is_whitelisted_and_bounded():
    config = server._normalize_landing_page_config({
        "copy": {
            "hero_title": "  Custom headline  ",
            "faq_0_answer": "A" * 900,
            "pro_positions_label": "PositionMeter preview",
            "pro_desk_ai_label": "Legacy preview label",
            "unlisted_internal_setting": "must not be public",
            "pricing_title": "   ",
        },
    })

    assert config["copy"]["hero_title"] == "Custom headline"
    assert len(config["copy"]["faq_0_answer"]) == 800
    assert config["copy"]["pro_positions_label"] == "PositionMeter preview"
    assert "pro_desk_ai_label" not in config["copy"]
    assert "unlisted_internal_setting" not in config["copy"]
    assert "pricing_title" not in config["copy"]


def test_landing_page_copy_drops_legacy_broker_faqs_and_accepts_current_faqs():
    config = server._normalize_landing_page_config({
        "copy": {
            "faq_3_question": "Is my broker password stored?",
            "faq_4_question": "Which brokers are supported?",
            "faq_data_question": "Is this data live?",
            "faq_signin_answer": "Continue with Google.",
        },
    })

    assert "faq_3_question" not in config["copy"]
    assert "faq_4_question" not in config["copy"]
    assert config["copy"]["faq_data_question"] == "Is this data live?"
    assert config["copy"]["faq_signin_answer"] == "Continue with Google."


def test_guest_login_setting_is_persisted_and_defaults_to_disabled(monkeypatch):
    class SettingsCollection:
        def __init__(self):
            self.saved = {}

        async def update_one(self, query, update, upsert=False):
            self.saved.update(update["$set"])

    settings = SettingsCollection()
    monkeypatch.setattr(server, "db", SimpleNamespace(settings=settings))

    async def load_config():
        return settings.saved

    monkeypatch.setattr(server, "_load_platform_config", load_config)
    assert asyncio.run(server._get_guest_login_enabled()) is False
    assert asyncio.run(server.admin_platform_config_get(_admin=True))["guest_login_enabled"] is False

    asyncio.run(server.admin_platform_config_set({"guest_login_enabled": True}, _admin=True))

    assert settings.saved["guest_login_enabled"] is True
    assert asyncio.run(server._get_guest_login_enabled()) is True
    assert asyncio.run(server.admin_platform_config_get(_admin=True))["guest_login_enabled"] is True
    asyncio.run(server.admin_platform_config_set({"guest_login_enabled": "true"}, _admin=True))
    assert settings.saved["guest_login_enabled"] is False


def test_public_entry_timeout_setting_is_admin_configured_and_publicly_minimal(monkeypatch):
    class SettingsCollection:
        def __init__(self):
            self.saved = {}

        async def update_one(self, query, update, upsert=False):
            self.saved.update(update["$set"])

    settings = SettingsCollection()
    monkeypatch.setattr(server, "db", SimpleNamespace(settings=settings))

    async def load_config():
        return settings.saved

    monkeypatch.setattr(server, "_load_platform_config", load_config)
    assert server._public_entry_auth_timeout_seconds({}) == 10
    assert server._public_entry_auth_timeout_seconds({
        "public_entry_auth_timeout_seconds": True,
    }) == 10
    assert server._public_entry_auth_timeout_seconds({
        "public_entry_auth_timeout_seconds": 4,
    }) == 5
    assert server._public_entry_auth_timeout_seconds({
        "public_entry_auth_timeout_seconds": 61,
    }) == 60
    assert asyncio.run(server.admin_platform_config_get(_admin=True))[
        "public_entry_auth_timeout_seconds"
    ] == 10

    settings.saved["google"] = {"client_secret_enc": "must-not-leak"}
    asyncio.run(server.admin_platform_config_set({
        "public_entry_auth_timeout_seconds": 45,
    }, _admin=True))

    assert settings.saved["public_entry_auth_timeout_seconds"] == 45
    assert asyncio.run(server.admin_platform_config_get(_admin=True))[
        "public_entry_auth_timeout_seconds"
    ] == 45
    assert asyncio.run(server.public_boot_config()) == {
        "public_entry_auth_timeout_seconds": 45,
    }

    for invalid in (True, 4, 61, 10.5, "20"):
        with pytest.raises(server.HTTPException) as error:
            asyncio.run(server.admin_platform_config_set({
                "public_entry_auth_timeout_seconds": invalid,
            }, _admin=True))
        assert error.value.status_code == 400
    assert settings.saved["public_entry_auth_timeout_seconds"] == 45


def test_public_site_config_exposes_sanitized_landing_visibility(monkeypatch):
    async def empty_config():
        return {
            "landing_page": {
                "copy": {
                    "hero_title": "Admin-approved headline",
                    "private_setting": "must not be returned",
                },
            },
        }

    monkeypatch.setattr(server, "_load_platform_config", empty_config)
    public_config = asyncio.run(server.public_site_config())

    assert public_config["landing_page"]["sections"]["broker_connect"] is False
    assert public_config["landing_page"]["sections"]["pricing"] is True
    assert public_config["landing_page"]["plan_more_info_enabled"] is True
    assert "plan_demo_snapshot" not in public_config["landing_page"]
    assert public_config["landing_page"]["copy"] == {"hero_title": "Admin-approved headline"}


def test_plan_preview_snapshot_rejects_private_or_unsupported_data():
    captured_at = datetime.now(timezone.utc).isoformat()
    with pytest.raises(ValueError, match="cannot contain member positions"):
        server._normalize_landing_plan_preview_snapshot({
            "captured_at": captured_at,
            "indices": {},
            "positions": [{"symbol": "PRIVATE"}],
        })
    with pytest.raises(ValueError, match="unsupported data section"):
        server._normalize_landing_plan_preview_snapshot({
            "captured_at": captured_at,
            "member_alerts": [],
        })
    with pytest.raises(ValueError, match="valid capture timestamp"):
        server._normalize_landing_plan_preview_snapshot({
            "captured_at": "not-a-timestamp",
        })


def test_plan_preview_snapshot_rejects_payloads_over_the_storage_limit():
    with pytest.raises(ValueError, match="larger than 3 MB"):
        server._normalize_landing_plan_preview_snapshot({
            "captured_at": datetime.now(timezone.utc).isoformat(),
            "market_intel": "x" * (3 * 1024 * 1024),
        })


def test_plan_preview_snapshot_accepts_shared_desk_market_brief():
    captured_at = datetime.now(timezone.utc).isoformat()
    desk_market = {
        "status": "captured",
        "data": {
            "movers": [{"index": "NIFTY", "symbol": "HDFCBANK", "weightage": 12.4, "pct": 0.54}],
            "breadth": {"NIFTY": {"n": 50, "adv": 31, "dec": 19}},
        },
    }

    result = server._normalize_landing_plan_preview_snapshot({
        "captured_at": captured_at,
        "desk_market": desk_market,
    })

    assert result["desk_market"] == desk_market


def test_public_plan_preview_filters_features_by_plan_entitlement(monkeypatch):
    membership = server._platform_membership({})
    entitled = membership["plans"]["normal"]["features"]
    selected = entitled[:1]
    snapshot = {
        "captured_at": datetime.now(timezone.utc).isoformat(),
        "indices": {},
        "market_intel": {"status": "unavailable", "data": None},
    }

    async def configured_platform():
        return {
            "membership": membership,
            "landing_page": {
                "plan_walkthrough_features": {
                    "normal": selected + ["positions"],
                },
                "plan_walkthrough_copy": {
                    selected[0]: {"description": "Admin copy", "edge": "Admin edge"},
                },
                "plan_demo_snapshot": snapshot,
            },
        }

    monkeypatch.setattr(server, "_load_platform_config", configured_platform)
    result = asyncio.run(server.public_landing_plan_preview("normal"))

    assert result["features"] == selected
    assert result["copy"] == {selected[0]: {"description": "Admin copy", "edge": "Admin edge"}}
    assert result["snapshot"] == snapshot


def test_public_plan_preview_cannot_restore_legacy_recommendation_features(monkeypatch):
    configured = {
        "membership": {
            "experience_enabled": True,
            "plans": {
                "pro": {
                    "features": [
                        "position_insights",
                        "writer_defense",
                        "suggestion_window",
                        "chart_signal_chips",
                        "positions",
                        "trade_journal",
                        "desk_ai",
                    ],
                },
            },
        },
        "landing_page": {
            "plan_walkthrough_features": {
                "pro": [
                    "position_insights",
                    "writer_defense",
                    "suggestion_window",
                    "chart_signal_chips",
                    "positions",
                    "trade_journal",
                    "desk_ai",
                ],
            },
        },
    }

    async def configured_platform():
        return configured

    monkeypatch.setattr(server, "_load_platform_config", configured_platform)
    result = asyncio.run(server.public_landing_plan_preview("pro"))

    assert set(result["features"]) == {"positions", "trade_journal", "desk_ai"}


@pytest.mark.parametrize(
    "endpoint",
    [server.public_landing_plan_preview, server.public_landing_plan_screenshots],
)
def test_public_plan_details_are_unavailable_when_more_info_is_disabled(monkeypatch, endpoint):
    async def configured_platform():
        return {"landing_page": {"plan_more_info_enabled": False}}

    monkeypatch.setattr(server, "_load_platform_config", configured_platform)

    with pytest.raises(server.HTTPException) as error:
        asyncio.run(endpoint("normal"))

    assert error.value.status_code == 404


@pytest.mark.parametrize(
    ("stored_value", "expected"),
    [(False, False), (None, True)],
)
def test_partial_landing_config_save_preserves_more_info_setting(monkeypatch, stored_value, expected):
    class Settings:
        async def update_one(self, _query, update, upsert=False):
            self.update = update

    settings = Settings()
    monkeypatch.setattr(server, "db", type("Database", (), {"settings": settings})())

    async def configured_platform():
        landing_page = {}
        if stored_value is not None:
            landing_page["plan_more_info_enabled"] = stored_value
        return {"landing_page": landing_page}

    monkeypatch.setattr(server, "_load_platform_config", configured_platform)
    asyncio.run(server.admin_platform_config_set({
        "landing_page": {"sections": {"pricing": True}},
    }, _admin=True))

    assert settings.update["$set"]["landing_page"]["plan_more_info_enabled"] is expected
