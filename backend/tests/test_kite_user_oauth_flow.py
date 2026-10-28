import asyncio
from types import SimpleNamespace

from starlette.requests import Request

import kite_callback_origin
import server


def _request(path, host="striklenz.com"):
    return Request({
        "type": "http",
        "method": "GET",
        "path": path,
        "headers": [(b"host", host.encode()), (b"x-forwarded-proto", b"https")],
        "query_string": b"",
        "server": (host, 443),
        "scheme": "https",
        "client": ("127.0.0.1", 1234),
    })


def test_kite_login_url_advertises_server_callback_redirect(monkeypatch):
    async def publisher_credentials():
        return "test-api-key", "test-api-secret"

    monkeypatch.setattr(server, "_publisher_api_key_secret", publisher_credentials)

    result = asyncio.run(server.kite_user_login_url(
        _request("/api/kite/user/login-url"),
        _role="guest",
    ))

    assert result["login_url"] == "https://kite.zerodha.com/connect/login?v=3&api_key=test-api-key"
    assert result["redirect_uri"] == "https://striklenz.com/api/kite/user/callback"
    assert result["redirect_uri"] in result["hint"]
    assert "test-api-secret" not in str(result)
    assert "Kite" not in result["hint"]
    assert "Zerodha" not in result["hint"]


def test_public_broker_errors_hide_provider_names():
    assert server._friendly_kite_connect_error(
        RuntimeError("Kite Connect request failed at https://api.kite.trade/quote")
    ) == "broker request failed at broker service"
    assert server._sanitize_public_error("Kite token expired") == (
        "Broker authentication issue — admin must reconnect"
    )


def test_public_broker_errors_hide_html_maintenance_response():
    assert server._friendly_kite_connect_error(
        RuntimeError("Unknown Content-Type (text/html): <html><body>503 Service Unavailable</body></html>")
    ) == "Broker service is temporarily unavailable. Please try again shortly."


def test_kite_callback_bridges_encoded_request_token_to_spa(monkeypatch):
    monkeypatch.setattr(kite_callback_origin, "kite_spa_origin", lambda _request: "https://striklenz.com")

    response = asyncio.run(server.kite_user_callback(
        _request("/api/kite/user/callback"),
        request_token="one-time/token+value",
        status="success",
    ))

    assert response.status_code == 302
    assert response.headers["location"] == (
        "https://striklenz.com/kite-callback?request_token=one-time%2Ftoken%2Bvalue&status=success"
    )
