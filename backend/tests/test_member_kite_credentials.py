import asyncio
import sys
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from fastapi import HTTPException
import pytest
from starlette.requests import Request

import kite_callback_origin
import server


def _request(path):
    return Request({
        "type": "http",
        "method": "POST",
        "path": path,
        "headers": [(b"host", b"striklenz.com"), (b"x-forwarded-proto", b"https")],
        "query_string": b"",
        "server": ("striklenz.com", 443),
        "scheme": "https",
        "client": ("127.0.0.1", 1234),
    })


def _mock_member_context(monkeypatch):
    async def member_context(_request, feature):
        assert feature == "positions"
        return {}, {}, "pro"

    async def guest_from_request(_request):
        return {
            "member_id": "member-123",
            "_id": "session-123",
            "email": "member@example.com",
            "name": "Pro Member",
        }

    monkeypatch.setattr(server, "_member_context", member_context)
    monkeypatch.setattr(server, "_guest_from_request", guest_from_request)


class MemberIdentityCollection:
    def __init__(self, linked_id=None):
        self.document = {"_id": "member-123"}
        if linked_id is not None:
            self.document["linked_kite_user_id"] = linked_id
        self.update = None

    async def update_one(self, query, update):
        self.update = (query, update)
        linked_id = self.document.get("linked_kite_user_id")
        matches = (
            linked_id is None
            or linked_id == update["$set"]["linked_kite_user_id"]
        )
        if matches:
            self.document.update(update["$set"])
        return SimpleNamespace(matched_count=int(matches))

    async def find_one(self, _query, _projection=None):
        return self.document


class EmptyKiteIdentityCollection:
    async def find_one(self, _query, _projection=None):
        return None


class SavedKiteIdentityCollection:
    async def find_one(self, _query, _projection=None):
        return {"kite_user_id": "LEGACY123"}


def test_member_credentials_are_encrypted_and_invalidate_previous_session(monkeypatch):
    class Collection:
        update = None

        async def find_one(self, query, projection=None):
            return None

        async def update_one(self, query, update, upsert):
            self.update = (query, update, upsert)

    class AuditCollection:
        inserted = None

        async def insert_one(self, document):
            self.inserted = document

    collection = Collection()
    audit = AuditCollection()
    monkeypatch.setattr(server, "db", SimpleNamespace(user_kite=collection, member_audit=audit))
    monkeypatch.setattr(
        server,
        "_fernet",
        lambda: SimpleNamespace(encrypt=lambda value: b"encrypted:" + value),
    )
    _mock_member_context(monkeypatch)

    result = asyncio.run(server.save_user_kite_credentials(
        server.UserKiteCredentialsIn(api_key="member-key", api_secret="member-secret"),
        _request("/api/kite/user/credentials"),
        role="guest",
    ))

    query, update, upsert = collection.update
    saved = update["$set"]
    assert query == {"member_id": "member-123"}
    assert upsert is True
    assert saved["api_key_enc"] == "encrypted:member-key"
    assert saved["api_secret_enc"] == "encrypted:member-secret"
    assert saved["_id"] == "member:member-123"
    assert saved["member_id"] == "member-123"
    assert "member_email" not in saved
    assert "member_name" not in saved
    assert update["$unset"] == {
        "access_token_enc": "",
        "kite_user_id": "",
        "valid_until": "",
    }
    assert "member-secret" not in str(result)
    assert audit.inserted["event_type"] == "broker_credentials_saved"
    assert audit.inserted["member_id"] == "member-123"
    assert "member-secret" not in str(audit.inserted)


def test_member_can_delete_personal_broker_credentials_after_plan_lapse(monkeypatch):
    class KiteCollection:
        deleted_query = None

        async def find_one(self, _query, _projection=None):
            return None

        async def delete_one(self, query):
            self.deleted_query = query
            return SimpleNamespace(deleted_count=1)

    class AuditCollection:
        inserted = None

        async def insert_one(self, document):
            self.inserted = document

    kite = KiteCollection()
    audit = AuditCollection()
    monkeypatch.setattr(server, "db", SimpleNamespace(user_kite=kite, member_audit=audit))

    async def member_session_from_request(_request):
        return {"member_id": "member-123", "_id": "session-123"}

    monkeypatch.setattr(server, "_member_session_from_request", member_session_from_request)
    result = asyncio.run(server.delete_user_kite_credentials(
        _request("/api/membership/broker-credentials"),
    ))

    assert result == {"ok": True, "credentials_configured": False, "connected": False}
    assert kite.deleted_query == {"member_id": "member-123"}
    assert audit.inserted["event_type"] == "broker_credentials_deleted"


def test_lapsed_member_can_check_saved_broker_credentials_without_positions_entitlement(monkeypatch):
    class KiteCollection:
        async def find_one(self, query, projection=None):
            assert query == {"member_id": "member-123"}
            return {
                "api_key_enc": "key-ciphertext",
                "api_secret_enc": "secret-ciphertext",
                "access_token_enc": "token-ciphertext",
                "valid_until": (datetime.now(timezone.utc) + timedelta(days=1)).isoformat(),
                "kite_user_id": "MEMBER1",
            }

    async def member_session_from_request(_request):
        return {"member_id": "member-123", "member": {"plan": "normal"}}

    class MemberCollection:
        async def find_one(self, query, projection=None):
            assert query == {"_id": "member-123"}
            return {"linked_kite_user_id": "MEMBER1"}

    monkeypatch.setattr(server, "db", SimpleNamespace(
        user_kite=KiteCollection(),
        members=MemberCollection(),
    ))
    monkeypatch.setattr(server, "_member_session_from_request", member_session_from_request)
    monkeypatch.setattr(
        server,
        "_decrypt_safe",
        lambda value: {"key-ciphertext": "member-key", "secret-ciphertext": "member-secret"}.get(value),
    )

    result = asyncio.run(server.membership_broker_credentials_status(
        _request("/api/membership/broker-credentials"),
    ))

    assert result["credentials_configured"] is True
    assert result["api_key_hint"] == "••••-key"
    assert result["connected"] is True
    assert result["kite_user_id"] == "MEMBER1"
    assert result["linked_kite_user_id"] == "MEMBER1"


def test_member_request_token_cannot_switch_to_a_different_zerodha_identity(monkeypatch):
    _mock_member_context(monkeypatch)
    member_identity = MemberIdentityCollection(linked_id="FIRST123")
    monkeypatch.setattr(server, "db", SimpleNamespace(
        members=member_identity,
        user_kite=EmptyKiteIdentityCollection(),
    ))
    monkeypatch.setattr(
        server,
        "_load_user_kite_doc",
        lambda _session: asyncio.sleep(0, result={
            "api_key_enc": "key-ciphertext",
            "api_secret_enc": "secret-ciphertext",
        }),
    )
    monkeypatch.setattr(
        server,
        "_decrypt_safe",
        lambda value: {
            "key-ciphertext": "member-key",
            "secret-ciphertext": "member-secret",
        }.get(value),
    )
    saved = []

    class FakeKiteConnect:
        def __init__(self, api_key):
            pass

        def generate_session(self, request_token, api_secret):
            return {"access_token": "other-account-token", "user_id": "SECOND456"}

    monkeypatch.setitem(sys.modules, "kiteconnect", SimpleNamespace(KiteConnect=FakeKiteConnect))
    monkeypatch.setattr(
        server,
        "_save_user_kite",
        lambda *_args, **_kwargs: asyncio.sleep(0, result=saved.append(True)),
    )

    with pytest.raises(HTTPException) as error:
        asyncio.run(server.kite_user_session(
            server.UserKiteSessionIn(request_token="valid-other-account-token"),
            _request("/api/kite/user/session"),
            role="guest",
        ))

    assert error.value.status_code == 403
    assert "FIRST123" in error.value.detail
    assert member_identity.document["linked_kite_user_id"] == "FIRST123"
    assert saved == []


def test_legacy_member_broker_id_becomes_the_immutable_linked_identity(monkeypatch):
    member_identity = MemberIdentityCollection()
    monkeypatch.setattr(server, "db", SimpleNamespace(
        members=member_identity,
        user_kite=SavedKiteIdentityCollection(),
    ))

    with pytest.raises(HTTPException) as error:
        asyncio.run(server._bind_member_kite_identity("member-123", "NEWACCOUNT"))

    assert error.value.status_code == 403
    assert "LEGACY123" in error.value.detail
    assert member_identity.document["linked_kite_user_id"] == "LEGACY123"


def test_member_login_url_uses_member_key_and_configured_callback(monkeypatch):
    _mock_member_context(monkeypatch)
    monkeypatch.setattr(
        server,
        "_member_session_from_request",
        lambda _request: asyncio.sleep(0, result={"member_id": "member-123"}),
    )
    monkeypatch.setattr(
        server,
        "_load_user_kite_doc",
        lambda _session: asyncio.sleep(0, result={
            "api_key_enc": "key-ciphertext",
            "api_secret_enc": "secret-ciphertext",
        }),
    )
    monkeypatch.setattr(
        server,
        "_decrypt_safe",
        lambda value: {
            "key-ciphertext": "member key+1",
            "secret-ciphertext": "member secret",
        }.get(value),
    )
    monkeypatch.setattr(
        kite_callback_origin,
        "kite_spa_origin",
        lambda _request: "https://striklenz.com",
    )

    result = asyncio.run(server.kite_user_login_url(
        _request("/api/kite/user/login-url"),
        _role="guest",
    ))

    assert "api_key=member+key%2B1" in result["login_url"]
    assert result["redirect_uri"] == "https://striklenz.com/api/kite/user/callback"
    assert "member secret" not in str(result)


def test_member_login_url_does_not_fall_back_to_publisher_credentials(monkeypatch):
    _mock_member_context(monkeypatch)
    monkeypatch.setattr(
        server,
        "_member_session_from_request",
        lambda _request: asyncio.sleep(0, result={"member_id": "member-123"}),
    )
    monkeypatch.setattr(
        server,
        "_load_user_kite_doc",
        lambda _session: asyncio.sleep(0, result=None),
    )
    monkeypatch.setattr(
        server,
        "_publisher_api_key_secret",
        lambda: asyncio.sleep(0, result=("publisher-key", "publisher-secret")),
    )

    with pytest.raises(HTTPException) as error:
        asyncio.run(server.kite_user_login_url(
            _request("/api/kite/user/login-url"),
            _role="guest",
        ))

    assert error.value.status_code == 400
    assert "Save your broker API key" in error.value.detail


def test_member_manual_request_token_exchange_uses_member_secret(monkeypatch):
    _mock_member_context(monkeypatch)
    member_identity = MemberIdentityCollection()
    monkeypatch.setattr(server, "db", SimpleNamespace(
        members=member_identity,
        user_kite=EmptyKiteIdentityCollection(),
    ))
    monkeypatch.setattr(
        server,
        "_load_user_kite_doc",
        lambda _session: asyncio.sleep(0, result={
            "api_key_enc": "key-ciphertext",
            "api_secret_enc": "secret-ciphertext",
        }),
    )
    monkeypatch.setattr(
        server,
        "_decrypt_safe",
        lambda value: {
            "key-ciphertext": "member-key",
            "secret-ciphertext": "member-secret",
        }.get(value),
    )
    generated = {}

    class FakeKiteConnect:
        def __init__(self, api_key):
            generated["api_key"] = api_key

        def generate_session(self, request_token, api_secret):
            generated["request_token"] = request_token
            generated["api_secret"] = api_secret
            return {"access_token": "one-time-access", "user_id": "MEMBER1"}

    monkeypatch.setitem(
        sys.modules,
        "kiteconnect",
        SimpleNamespace(KiteConnect=FakeKiteConnect),
    )

    async def save_session(_guest, *, access_token, kite_user_id):
        generated["saved_access_token"] = access_token
        generated["saved_user_id"] = kite_user_id
        return {"valid_until": "2026-10-14T06:00:00+05:30"}

    monkeypatch.setattr(server, "_save_user_kite", save_session)
    result = asyncio.run(server.kite_user_session(
        server.UserKiteSessionIn(request_token="manual-request-token"),
        _request("/api/kite/user/session"),
        role="guest",
    ))

    assert generated == {
        "api_key": "member-key",
        "request_token": "manual-request-token",
        "api_secret": "member-secret",
        "saved_access_token": "one-time-access",
        "saved_user_id": "MEMBER1",
    }
    assert result["connected"] is True
    assert result["kite_user_id"] == "MEMBER1"
    assert member_identity.document["linked_kite_user_id"] == "MEMBER1"


def test_member_positions_client_uses_the_saved_member_api_key(monkeypatch):
    client_state = {}

    class FakeKiteConnect:
        def __init__(self, api_key):
            client_state["api_key"] = api_key

        def set_access_token(self, access_token):
            client_state["access_token"] = access_token

    monkeypatch.setitem(
        sys.modules,
        "kiteconnect",
        SimpleNamespace(KiteConnect=FakeKiteConnect),
    )
    monkeypatch.setattr(
        server,
        "_load_user_kite_doc",
        lambda _session: asyncio.sleep(0, result={
            "api_key_enc": "member-key-ciphertext",
            "api_secret_enc": "member-secret-ciphertext",
            "access_token_enc": "member-token-ciphertext",
            "valid_until": (datetime.now(timezone.utc) + timedelta(days=1)).isoformat(),
        }),
    )
    monkeypatch.setattr(
        server,
        "_decrypt_safe",
        lambda value: {
            "member-key-ciphertext": "member-api-key",
            "member-secret-ciphertext": "member-api-secret",
            "member-token-ciphertext": "member-access-token",
        }.get(value),
    )
    monkeypatch.setattr(
        server,
        "_fernet",
        lambda: SimpleNamespace(decrypt=lambda value: {
            b"member-token-ciphertext": b"member-access-token",
        }.get(value)),
    )

    async def publisher_credentials():
        raise AssertionError("Member positions must not use publisher credentials")

    monkeypatch.setattr(server, "_publisher_api_key_secret", publisher_credentials)
    client, status = asyncio.run(server._user_kite_client({"member_id": "member-123"}))

    assert client is not None
    assert status["connected"] is True
    assert client_state == {
        "api_key": "member-api-key",
        "access_token": "member-access-token",
    }


def test_member_auth_status_includes_connected_account_id_and_masked_key(monkeypatch):
    member = {
        "member_id": "member-123",
        "name": "Pro Member",
        "email": "member@example.com",
    }
    monkeypatch.setattr(
        server,
        "_load_user_kite_doc",
        lambda _session: asyncio.sleep(0, result={
            "api_key_enc": "member-key-ciphertext",
            "api_secret_enc": "member-secret-ciphertext",
            "access_token_enc": "member-token-ciphertext",
            "kite_user_id": "BROKER123",
            "valid_until": (datetime.now(timezone.utc) + timedelta(days=1)).isoformat(),
        }),
    )
    monkeypatch.setattr(
        server,
        "_decrypt_safe",
        lambda value: {
            "member-key-ciphertext": "member-api-key-7890",
            "member-secret-ciphertext": "member-api-secret",
        }.get(value),
    )

    status = asyncio.run(server._auth_user_kite_payload(False, member))

    assert status["connected"] is True
    assert status["kite_user_id"] == "BROKER123"
    assert status["credentials_configured"] is True
    assert status["api_key_hint"].endswith("7890")
    assert status["member_email"] == "member@example.com"
    assert "member-api-secret" not in str(status)


def test_member_positions_never_fall_back_to_publisher_key(monkeypatch):
    monkeypatch.setitem(sys.modules, "kiteconnect", SimpleNamespace(KiteConnect=object))
    monkeypatch.setattr(
        server,
        "_load_user_kite_doc",
        lambda _session: asyncio.sleep(0, result={
            "access_token_enc": "member-token-ciphertext",
            "valid_until": (datetime.now(timezone.utc) + timedelta(days=1)).isoformat(),
        }),
    )
    monkeypatch.setattr(server, "_decrypt_safe", lambda _value: None)
    monkeypatch.setattr(
        server,
        "_fernet",
        lambda: SimpleNamespace(decrypt=lambda _value: b"member-access-token"),
    )

    async def publisher_credentials():
        raise AssertionError("Pro Positions must never use publisher credentials")

    monkeypatch.setattr(server, "_publisher_api_key_secret", publisher_credentials)
    client, status = asyncio.run(server._user_kite_client({"member_id": "member-123"}))

    assert client is None
    assert status["connected"] is False
    assert status["credentials_configured"] is False


def test_member_sign_out_preserves_encrypted_app_credentials(monkeypatch):
    class Collection:
        update = None

        async def update_one(self, query, update):
            self.update = (query, update)

    class AuditCollection:
        inserted = None

        async def insert_one(self, document):
            self.inserted = document

    collection = Collection()
    audit = AuditCollection()
    monkeypatch.setattr(server, "db", SimpleNamespace(user_kite=collection, member_audit=audit))
    _mock_member_context(monkeypatch)

    result = asyncio.run(server.kite_user_disconnect(
        _request("/api/kite/user/disconnect"),
        role="guest",
    ))

    query, update = collection.update
    assert query == {"member_id": "member-123"}
    assert update["$unset"] == {
        "access_token_enc": "",
        "kite_user_id": "",
        "valid_until": "",
    }
    assert "api_key_enc" not in update["$unset"]
    assert "api_secret_enc" not in update["$unset"]
    assert result == {"ok": True, "connected": False}
    assert audit.inserted["event_type"] == "broker_session_disconnected"
