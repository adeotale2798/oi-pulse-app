import asyncio
import hashlib
import hmac
import json
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import server
from starlette.requests import Request


class Collection:
    def __init__(self, document=None):
        self.document = document
        self.updated = []
        self.inserted = []

    async def find_one(self, query, projection=None):
        return self.document if query.get("_id") == (self.document or {}).get("_id") else None

    async def update_one(self, query, update, upsert=False):
        self.updated.append((query, update, upsert))

    async def insert_one(self, document):
        self.inserted.append(document)


def _webhook_request(event):
    body = json.dumps(event).encode()
    signature = hmac.new(b"test-webhook-secret", body, hashlib.sha256).hexdigest()

    async def receive():
        return {"type": "http.request", "body": body, "more_body": False}

    return Request({
        "type": "http",
        "method": "POST",
        "path": "/api/billing/razorpay/webhook",
        "headers": [
            (b"x-razorpay-signature", signature.encode()),
            (b"x-razorpay-event-id", b"event-123"),
        ],
        "query_string": b"",
        "server": ("striklenz.com", 443),
        "scheme": "https",
        "client": ("127.0.0.1", 1234),
    }, receive)


def _configure_webhook(monkeypatch, event):
    end = (datetime.now(timezone.utc) + timedelta(days=10)).timestamp()
    subscription = Collection({
        "_id": "sub-123",
        "user_id": "member-123",
        "plan": "pro",
        "cadence": "monthly",
        "status": "active",
        "current_end": end,
    })
    members = Collection()
    billing_events = Collection()
    member_audit = Collection()
    member_journal = Collection({"_id": "journal-one", "user_id": "member-123", "notes": "keep"})
    user_kite = Collection({"_id": "kite-one", "member_id": "member-123", "api_key_enc": "encrypted"})
    monkeypatch.setattr(server, "db", SimpleNamespace(
        member_subscriptions=subscription,
        members=members,
        billing_events=billing_events,
        member_audit=member_audit,
        member_journal=member_journal,
        user_kite=user_kite,
    ))

    async def load_platform_config():
        return {"razorpay": {"enabled": True, "webhook_secret_enc": "test-webhook-secret"}}

    monkeypatch.setattr(server, "_load_platform_config", load_platform_config)
    monkeypatch.setattr(server, "_decrypt_safe", lambda value: value)
    return (
        subscription,
        members,
        billing_events,
        member_audit,
        member_journal,
        user_kite,
        _webhook_request(event),
    )


def _event(event_type, *, payment=None):
    payload = {
        "subscription": {
            "entity": {
                "id": "sub-123",
                "current_end": (datetime.now(timezone.utc) + timedelta(days=10)).timestamp(),
            }
        }
    }
    if payment is not None:
        payload = {"payment": {"entity": payment}}
    return {"id": "provider-event-123", "event": event_type, "payload": payload}


def test_webhook_lifecycle_updates_entitlement_only_from_provider_state(monkeypatch):
    cases = [
        (_event("subscription.activated"), "active", "pro"),
        (_event("subscription.cancelled"), "cancelled", "normal"),
        (_event("subscription.completed"), "completed", "normal"),
        (_event("subscription.halted"), "halted", "normal"),
        (_event("payment.failed", payment={"subscription_id": "sub-123"}), "past_due", "normal"),
        (_event("payment.refunded", payment={
            "id": "pay-123",
            "subscription_id": "sub-123",
            "amount": 10000,
            "amount_refunded": 10000,
        }), "refunded", "normal"),
    ]

    for event, expected_status, expected_plan in cases:
        subscription, members, billing_events, audit, member_journal, user_kite, request = _configure_webhook(monkeypatch, event)
        result = asyncio.run(server.razorpay_webhook(request))

        assert result == {"ok": True}
        saved_subscription = subscription.updated[0][1]["$set"]
        saved_member = members.updated[0][1]["$set"]
        assert saved_subscription["status"] == expected_status
        assert saved_member["subscription.status"] == expected_status
        assert saved_member["subscription.plan"] == "pro"
        assert saved_member["plan"] == expected_plan
        assert server._effective_member_plan({
            "plan": saved_member.get("plan", "pro"),
            "subscription": {
                "status": saved_member["subscription.status"],
                "current_end": saved_member.get(
                    "subscription.current_end",
                    subscription.document["current_end"],
                ),
            },
        }) == expected_plan
        assert billing_events.updated
        assert audit.inserted[0]["details"]["status"] == expected_status
        assert member_journal.updated == []
        assert user_kite.updated == []
        assert member_journal.document["notes"] == "keep"
        assert user_kite.document["api_key_enc"] == "encrypted"


def test_partial_refund_does_not_remove_subscription_entitlement(monkeypatch):
    event = _event("payment.refunded", payment={
        "id": "pay-123",
        "subscription_id": "sub-123",
        "amount": 10000,
        "amount_refunded": 2500,
    })
    subscription, members, billing_events, audit, _journal, _kite, request = _configure_webhook(monkeypatch, event)

    result = asyncio.run(server.razorpay_webhook(request))

    assert result == {"ok": True, "ignored": True}
    assert subscription.updated == []
    assert members.updated == []
    assert billing_events.updated == []
    assert audit.inserted == []


def test_duplicate_webhook_event_is_not_applied_twice(monkeypatch):
    event = _event("subscription.cancelled")
    subscription, members, billing_events, audit, _journal, _kite, request = _configure_webhook(monkeypatch, event)
    billing_events.document = {"_id": "event-123"}

    result = asyncio.run(server.razorpay_webhook(request))

    assert result == {"ok": True, "duplicate": True}
    assert subscription.updated == []
    assert members.updated == []
    assert audit.inserted == []


def test_out_of_order_webhook_cannot_restore_access(monkeypatch):
    event = _event("subscription.activated")
    event["created_at"] = 100
    subscription, members, billing_events, audit, _journal, _kite, request = _configure_webhook(monkeypatch, event)
    subscription.document["last_event_created_at"] = 200

    result = asyncio.run(server.razorpay_webhook(request))

    assert result == {"ok": True, "ignored": True, "stale": True}
    assert subscription.updated == []
    assert members.updated == []
    assert audit.inserted == []
    assert billing_events.updated[0][1]["$setOnInsert"]["ignored_as_stale"] is True


def test_member_cancellation_ends_access_immediately(monkeypatch):
    current_end = (datetime.now(timezone.utc) + timedelta(days=10)).timestamp()
    subscription = Collection({
        "_id": "sub-123",
        "user_id": "member-123",
        "status": "active",
        "current_end": current_end,
    })
    members = Collection()
    monkeypatch.setattr(server, "db", SimpleNamespace(
        member_subscriptions=subscription,
        members=members,
    ))

    async def member_context(_request):
        return (
            {"member_id": "member-123", "member": {"subscription": {"id": "sub-123"}}},
            {},
            "pro",
        )

    async def platform_config():
        return {"razorpay": {"enabled": True, "key_id_enc": "key", "key_secret_enc": "secret"}}

    audit_events = []

    async def record_audit(*args):
        audit_events.append(args)

    provider_calls = []

    class Response:
        def raise_for_status(self):
            return None

        def json(self):
            return {"status": "cancelled", "current_end": current_end}

    class Client:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return False

        async def post(self, url, json):
            provider_calls.append((url, json))
            return Response()

    monkeypatch.setattr(server, "_member_context", member_context)
    monkeypatch.setattr(server, "_load_platform_config", platform_config)
    monkeypatch.setattr(server, "_decrypt_safe", lambda value: value)
    monkeypatch.setattr(server, "_record_member_audit", record_audit)
    monkeypatch.setattr("httpx.AsyncClient", Client)

    result = asyncio.run(server.membership_cancel(None))

    assert result == {
        "ok": True,
        "status": "cancelled",
        "plan": "normal",
        "current_end": current_end,
    }
    assert provider_calls[0][1] == {"cancel_at_cycle_end": 0}
    member_patch = members.updated[0][1]["$set"]
    assert member_patch["plan"] == "normal"
    assert member_patch["admin_plan_override"] is False
    assert member_patch["subscription.status"] == "cancelled"
    assert server._effective_member_plan({
        "plan": "pro",
        "subscription": {"status": "cancelled", "current_end": current_end},
    }) == "normal"
    assert audit_events[0][3]["access_ends_immediately"] is True


def test_membership_profile_exposes_only_callers_redacted_subscription_history(monkeypatch):
    now = datetime.now(timezone.utc)

    class HistoryCursor:
        def __init__(self, rows):
            self.rows = rows

        def sort(self, *_args):
            return self

        async def to_list(self, length=None):
            return self.rows[:length]

    class AuditCollection:
        def __init__(self):
            self.query = None
            self.projection = None

        def find(self, query, projection):
            self.query = query
            self.projection = projection
            return HistoryCursor([
                {
                    "event_type": "subscription_status_changed",
                    "details": {
                        "plan": "pro",
                        "status": "past_due",
                        "event_type": "payment.failed",
                        "api_secret": "must-not-escape",
                    },
                    "created_at": now,
                },
            ])

    audit = AuditCollection()
    monkeypatch.setattr(server, "db", SimpleNamespace(member_audit=audit))
    membership = server._platform_membership({})
    membership["preference_defaults"] = {}

    async def member_context(_request):
        return (
            {
                "member_id": "member-123",
                "member": {
                    "_id": "member-123",
                    "email": "member@example.test",
                    "preferences": {},
                    "subscription": {"status": "past_due"},
                },
            },
            membership,
            "normal",
        )

    monkeypatch.setattr(server, "_member_context", member_context)
    result = asyncio.run(server.membership_me(None))

    assert audit.query["member_id"] == "member-123"
    assert audit.query["event_type"]["$in"] == [
        "subscription_checkout_created",
        "subscription_renewal_cancelled",
        "subscription_status_changed",
    ]
    assert result["subscription_history"] == [{
        "event_type": "subscription_status_changed",
        "details": {"plan": "pro", "status": "past_due"},
        "created_at": now,
    }]


def test_cancellation_patch_preserves_member_owned_data(monkeypatch):
    member_data = {
        "preferences": {"alert_indices": ["NIFTY"]},
        "profile_note": "keep",
        "subscription": {"id": "sub-123", "status": "active"},
    }
    current_end = (datetime.now(timezone.utc) + timedelta(days=10)).timestamp()
    members = Collection(member_data.copy())
    member_journal = Collection({"_id": "journal-one", "user_id": "member-123", "notes": "keep"})
    user_kite = Collection({"_id": "kite-one", "member_id": "member-123", "api_key_enc": "encrypted"})
    monkeypatch.setattr(server, "db", SimpleNamespace(
        member_subscriptions=Collection({
            "_id": "sub-123",
            "user_id": "member-123",
            "status": "active",
            "current_end": current_end,
        }),
        members=members,
        member_journal=member_journal,
        user_kite=user_kite,
    ))

    async def member_context(_request):
        return (
            {"member_id": "member-123", "member": {"subscription": {"id": "sub-123"}}},
            {},
            "pro",
        )

    async def platform_config():
        return {"razorpay": {"enabled": True, "key_id_enc": "key", "key_secret_enc": "secret"}}

    async def no_audit(*_args):
        return None

    class Response:
        def raise_for_status(self):
            return None

        def json(self):
            return {"status": "cancelled", "current_end": current_end}

    class Client:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return False

        async def post(self, _url, json):
            assert json == {"cancel_at_cycle_end": 0}
            return Response()

    monkeypatch.setattr(server, "_member_context", member_context)
    monkeypatch.setattr(server, "_load_platform_config", platform_config)
    monkeypatch.setattr(server, "_decrypt_safe", lambda value: value)
    monkeypatch.setattr(server, "_record_member_audit", no_audit)
    monkeypatch.setattr("httpx.AsyncClient", Client)

    asyncio.run(server.membership_cancel(None))

    update = members.updated[0][1]
    assert set(update) == {"$set"}
    assert "preferences" not in update["$set"]
    assert "profile_note" not in update["$set"]
    assert member_data["preferences"] == {"alert_indices": ["NIFTY"]}
    assert member_data["profile_note"] == "keep"
    assert member_journal.updated == []
    assert user_kite.updated == []
    assert member_journal.document["notes"] == "keep"
    assert user_kite.document["api_key_enc"] == "encrypted"
