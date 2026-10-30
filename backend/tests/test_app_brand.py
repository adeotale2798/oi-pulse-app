from pathlib import Path

from app_version import load_app_name, load_app_version, APP_NAME, APP_VERSION


def test_app_name_comes_from_repo_root_file():
    root = Path(__file__).resolve().parents[2]
    expected = (root / "APP_NAME").read_text(encoding="utf-8").strip().splitlines()[0].strip()
    assert expected == "StrikLenz"
    assert load_app_name() == expected
    assert APP_NAME == expected
    assert expected


def test_app_version_file_still_loads():
    root = Path(__file__).resolve().parents[2]
    expected = (root / "VERSION").read_text(encoding="utf-8").strip().splitlines()[0].strip()
    assert load_app_version() == expected
    assert APP_VERSION == expected


def test_adrs_is_allowed_dashboard_page():
    text = Path(__file__).resolve().parents[1].joinpath("server.py").read_text(encoding="utf-8")
    start = text.index("DASHBOARD_PAGE_KEYS")
    block = text[start:text.index("}", start)]
    assert '"adrs"' in block
    assert '"sell-candidates"' not in block


def test_settings_sanitizer_removes_retired_page_and_suggestion_setting():
    from server import _sanitize_settings_catalog_values

    settings = {
        "visible_pages": ["oi-change", "sell-candidates"],
        "admin_visible_pages": ["sell-candidates", "open-interest"],
        "show_suggestion": True,
    }

    _sanitize_settings_catalog_values(settings)

    assert settings["visible_pages"] == ["oi-change"]
    assert settings["admin_visible_pages"] == ["open-interest"]
    assert settings["show_suggestion"] is False
