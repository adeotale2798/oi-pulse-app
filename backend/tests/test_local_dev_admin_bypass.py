import asyncio

from fastapi import HTTPException, Request

import server


def make_request(host, client_host):
    return Request(
        {
            "type": "http",
            "http_version": "1.1",
            "method": "GET",
            "scheme": "http",
            "path": "/api/auth/state",
            "raw_path": b"/api/auth/state",
            "query_string": b"",
            "headers": [(b"host", host.encode("ascii"))],
            "client": (client_host, 12345),
            "server": ("127.0.0.1", 8000),
        }
    )


def test_local_bypass_grants_admin_only_on_loopback(monkeypatch):
    monkeypatch.setattr(server, "APP_ENV", "development")
    monkeypatch.setattr(server, "LOCAL_DEV_ADMIN_BYPASS_ENABLED", True)
    monkeypatch.setattr(server, "db", None)

    local_request = make_request("localhost:8000", "127.0.0.1")
    admin = asyncio.run(server._admin_from_request(local_request))
    assert admin["local_dev_admin_bypass"] is True
    assert asyncio.run(server.require_admin(local_request)) is True
    auth_state = asyncio.run(server.auth_state(local_request))
    assert auth_state["is_admin"] is True
    assert auth_state["local_dev_admin_bypass"] is True

    lan_request = make_request("192.168.1.10:8000", "192.168.1.25")
    assert not server._is_local_dev_admin_bypass_request(lan_request)
    try:
        asyncio.run(server.require_admin(lan_request))
    except HTTPException as exc:
        assert exc.status_code == 401
    else:
        raise AssertionError("LAN request must not receive local admin access")

    spoofed_host_request = make_request("localhost:8000", "203.0.113.10")
    assert not server._is_local_dev_admin_bypass_request(spoofed_host_request)


def test_local_bypass_requires_development_environment(monkeypatch):
    monkeypatch.setattr(server, "LOCAL_DEV_ADMIN_BYPASS_ENABLED", True)
    monkeypatch.setattr(server, "APP_ENV", "production")

    request = make_request("localhost:8000", "127.0.0.1")
    assert not server._is_local_dev_admin_bypass_request(request)
    assert asyncio.run(server._admin_from_request(request)) is None


def test_local_bypass_is_opt_in(monkeypatch):
    monkeypatch.setattr(server, "APP_ENV", "development")
    monkeypatch.setattr(server, "LOCAL_DEV_ADMIN_BYPASS_ENABLED", False)

    request = make_request("localhost:8000", "127.0.0.1")
    assert not server._is_local_dev_admin_bypass_request(request)
    assert asyncio.run(server._admin_from_request(request)) is None


def test_local_member_test_login_is_development_loopback_only(monkeypatch):
    monkeypatch.setattr(server, "APP_ENV", "development")
    monkeypatch.setattr(
        server,
        "LOCAL_DEV_MEMBER_USERS",
        {"pro@example.test": {"password": "not-used", "plan": "pro"}},
    )

    local_request = make_request("localhost:8000", "127.0.0.1")
    assert server._is_local_dev_request(local_request)

    lan_request = make_request("192.168.1.10:8000", "192.168.1.25")
    assert not server._is_local_dev_request(lan_request)
    try:
        asyncio.run(server.local_dev_member_login({}, lan_request))
    except HTTPException as exc:
        assert exc.status_code == 404
    else:
        raise AssertionError("LAN request must not access local test login")

    monkeypatch.setattr(server, "APP_ENV", "production")
    assert not server._is_local_dev_request(local_request)


def test_cas_access_rejects_members_but_preserves_admin_and_guest(monkeypatch):
    request = make_request("localhost:8000", "127.0.0.1")

    async def not_admin(_request):
        return False

    async def member_session(_request):
        return {"is_member": True}

    async def guest_session(_request):
        return {"is_member": False}

    monkeypatch.setattr(server, "_is_admin_request", not_admin)
    monkeypatch.setattr(server, "_member_session_from_request", member_session)
    monkeypatch.setattr(server, "_guest_from_request", guest_session)
    try:
        asyncio.run(server.require_cas_desk_user(request))
    except HTTPException as exc:
        assert exc.status_code == 403
    else:
        raise AssertionError("Member accounts must not access CAS")

    async def no_member(_request):
        return None

    async def is_admin(_request):
        return True

    monkeypatch.setattr(server, "_member_session_from_request", no_member)
    assert asyncio.run(server.require_cas_desk_user(request)) == "guest"
    monkeypatch.setattr(server, "_is_admin_request", is_admin)
    assert asyncio.run(server.require_cas_desk_user(request)) == "admin"
