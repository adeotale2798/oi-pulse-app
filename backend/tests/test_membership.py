import base64
from datetime import datetime, timedelta, timezone

import pytest
import server

from membership import (
    DEFAULT_MEMBERSHIP,
    member_alert_purge_cutoff,
    next_member_alert_purge,
    normalize_member_preferences,
    normalize_membership,
    plan_features,
)
from local_dev_auth import local_test_password_matches, parse_local_test_users


def test_membership_defaults_keep_rollout_closed_and_mcxs_out_of_member_features():
    config = normalize_membership(None)

    assert config["experience_enabled"] is False
    assert config["signup_enabled"] is False
    assert config["paid_subscriptions_enabled"] is False
    assert "positions" not in config["plans"]["normal"]["features"]
    assert "alert_sounds" not in config["plans"]["normal"]["features"]
    assert "alert_sounds" in config["plans"]["premium"]["features"]
    assert "desk_ai" in config["plans"]["pro"]["features"]
    assert "mcx" not in {
        feature.lower() for plan in config["plans"].values()
        for feature in plan["features"]
    }


def test_membership_normalization_filters_unknown_features_and_clamps_preferences():
    config = normalize_membership({
        "experience_enabled": True,
        "plans": {"premium": {"features": ["market_intel", "mcx", "market_intel"]}},
        "early_access": {"enabled": True, "discount_percent": 150},
        "preference_defaults": {
            "alert_indices": ["NIFTY", "CRUDEOIL", "NIFTY"],
            "oi_change_threshold_pct": -5,
            "alert_cooldown_seconds": 1,
        },
    })

    assert config["plans"]["premium"]["features"] == ["market_intel"]
    assert config["early_access"]["discount_percent"] == 100
    assert config["preference_defaults"]["alert_indices"] == ["NIFTY"]
    assert config["preference_defaults"]["oi_change_threshold_pct"] == 1
    assert config["preference_defaults"]["alert_cooldown_seconds"] == 30
    normal_with_sound_controls = normalize_membership({
        "plans": {"normal": {"features": ["alert_sounds"]}},
    })
    assert normal_with_sound_controls["plans"]["normal"]["features"] == ["alert_sounds"]


def test_member_plans_cannot_enable_recommendation_surfaces():
    restricted = {
        "sell_candidates",
        "position_insights",
        "writer_defense",
        "suggestion_window",
        "chart_signal_chips",
    }
    config = normalize_membership({
        "experience_enabled": True,
        "plans": {
            "premium": {"features": ["sell_candidates", "alerts"]},
            "pro": {"features": [
                "position_insights", "writer_defense", "suggestion_window",
                "chart_signal_chips", "positions", "desk_ai",
            ]},
        },
        "preference_defaults": {
            "show_writer_defense": True,
            "show_suggestion": True,
            "show_chart_signals": True,
        },
    })

    assert not restricted.intersection(config["plans"]["premium"]["features"])
    assert not restricted.intersection(config["plans"]["pro"]["features"])
    assert config["preference_defaults"]["show_writer_defense"] is False
    assert config["preference_defaults"]["show_suggestion"] is False
    assert config["preference_defaults"]["show_chart_signals"] is False

    preferences = normalize_member_preferences({
        "show_writer_defense": True,
        "show_suggestion": True,
        "show_chart_signals": True,
    })
    assert preferences["show_writer_defense"] is False
    assert preferences["show_suggestion"] is False
    assert preferences["show_chart_signals"] is False


def test_plan_features_require_rollout_and_plan_enablement():
    config = normalize_membership(DEFAULT_MEMBERSHIP)

    assert plan_features(config, "pro") == set()

    config["experience_enabled"] = True
    assert "desk_ai" in plan_features(config, "pro")
    assert "alert_sounds" in plan_features(config, "premium")
    config["plans"]["normal"]["features"].append("alert_sounds")
    assert "alert_sounds" in plan_features(config, "normal")
    config["plans"]["pro"]["enabled"] = False
    assert plan_features(config, "pro") == set()


def test_member_preferences_are_scoped_and_bounded():
    prefs = normalize_member_preferences({
        "alert_indices": ["NIFTY", "CRUDEOIL", "NIFTY"],
        "oi_change_threshold_pct": 0,
        "alert_cooldown_seconds": 9000,
        "oi_shift_threshold_contracts": -1,
        "alert_types": {"oi_change": False},
        "trade_cycle_persistence_enabled": True,
        "hidden_dashboard_pages": ["positions", "invalid", "positions", 42],
    })

    assert prefs["alert_indices"] == ["NIFTY"]
    assert prefs["oi_change_threshold_pct"] == 1
    assert prefs["alert_cooldown_seconds"] == 3600
    assert prefs["oi_shift_threshold_contracts"] == 1
    assert prefs["alert_types"]["oi_change"] is False
    assert prefs["alert_types"]["oi_shift"] is True
    assert prefs["hidden_dashboard_pages"] == ["positions"]


def test_public_landing_config_exposes_screenshot_metadata_without_image_payload():
    image = base64.b64encode(b"\x89PNG\r\n\x1a\nsmall-test-image").decode("ascii")
    landing = {
        "plan_screenshots": {
            "premium": [{
                "id": "premium-shot-1",
                "title": "Premium alerts",
                "data_url": f"data:image/png;base64,{image}",
            }],
        },
    }

    admin_config = server._normalize_landing_page_config(landing)
    public_config = server._normalize_landing_page_config(
        landing,
        include_screenshot_data=False,
    )

    assert admin_config["plan_screenshots"]["premium"][0]["data_url"].startswith("data:image/png")
    assert public_config["plan_screenshots"]["premium"] == [{
        "id": "premium-shot-1",
        "title": "Premium alerts",
        "mime_type": "image/png",
    }]


def test_plan_screenshot_normalization_rejects_invalid_uploads():
    with pytest.raises(ValueError, match="PNG, JPEG, or WebP"):
        server._normalize_landing_plan_screenshots(
            {"normal": [{"id": "bad", "title": "Bad image", "data_url": "data:image/svg+xml;base64,PHN2Zz4="}]},
            strict=True,
        )


def test_alert_retention_switches_at_0900_ist():
    before_boundary = datetime(2025, 1, 2, 3, 29, tzinfo=timezone.utc)
    at_boundary = datetime(2025, 1, 2, 3, 30, tzinfo=timezone.utc)

    assert member_alert_purge_cutoff(before_boundary) == datetime(
        2025, 1, 1, 3, 30, tzinfo=timezone.utc
    )
    assert member_alert_purge_cutoff(at_boundary) == at_boundary
    assert next_member_alert_purge(before_boundary) == at_boundary
    assert next_member_alert_purge(at_boundary) == datetime(
        2025, 1, 3, 3, 30, tzinfo=timezone.utc
    )


def test_local_test_users_are_disabled_outside_development():
    raw = '[{"email":"normal@example.test","password":"test-pass","plan":"normal"}]'

    assert parse_local_test_users(raw, "production") == {}


def test_local_test_users_are_normalized_and_passwords_compared():
    users = parse_local_test_users(
        '[{"email":"PRO@example.test","password":"test-pass","plan":"pro"}]',
        "development",
    )

    assert users == {"pro@example.test": {"password": "test-pass", "plan": "pro"}}
    assert local_test_password_matches("test-pass", users["pro@example.test"]["password"])
    assert not local_test_password_matches("wrong", users["pro@example.test"]["password"])


def test_local_test_user_configuration_rejects_invalid_or_duplicate_entries():
    with pytest.raises(ValueError):
        parse_local_test_users("not-json", "development")
    with pytest.raises(ValueError):
        parse_local_test_users(
            '[{"email":"a@example.test","password":"a","plan":"pro"},'
            '{"email":"A@example.test","password":"b","plan":"normal"}]',
            "development",
        )


@pytest.mark.parametrize(
    ("status", "current_end_delta", "expected"),
    [
        ("active", timedelta(days=1), "pro"),
        ("cancelled", timedelta(days=1), "normal"),
        ("cancelled", timedelta(seconds=-1), "normal"),
        ("past_due", timedelta(days=1), "normal"),
        ("halted", timedelta(days=1), "normal"),
        ("refunded", timedelta(days=1), "normal"),
        ("completed", timedelta(days=1), "normal"),
        ("expired", timedelta(days=1), "normal"),
        ("active", timedelta(seconds=-1), "normal"),
    ],
)
def test_paid_access_lifecycle_uses_current_provider_state(status, current_end_delta, expected):
    now = datetime(2026, 10, 13, tzinfo=timezone.utc)
    member = {
        "plan": "pro",
        "subscription": {
            "status": status,
            "current_end": (now + current_end_delta).isoformat(),
        },
    }

    assert server._effective_member_plan(member, now) == expected


def test_admin_override_survives_provider_failure_and_suspension_does_not_remove_data():
    member = {
        "plan": "pro",
        "admin_plan_override": True,
        "subscription": {"status": "past_due", "current_end": "2026-10-14T00:00:00+00:00"},
        "disabled_at": None,
        "preferences": {"trade_cycle_persistence_enabled": True},
    }

    assert server._effective_member_plan(member) == "pro"
    member["disabled_at"] = "2026-10-13T00:00:00+00:00"
    assert server._effective_member_plan(member) == "normal"
    assert member["subscription"]["status"] == "past_due"
    assert member["preferences"]["trade_cycle_persistence_enabled"] is True
