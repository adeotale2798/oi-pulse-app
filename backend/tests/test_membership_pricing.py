import asyncio
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from starlette.requests import Request

import server


class Collection:
    def __init__(self):
        self.updated = []

    async def find_one(self, _query, projection=None):
        return None

    async def update_one(self, query, update, upsert=False):
        self.updated.append((query, update, upsert))


def test_public_pricing_includes_only_valid_offer_prices():
    public = server._public_pricing({
        "pricing": {
            "premium": {
                "monthly": 999,
                "offer_prices": {"monthly": 799, "quarterly": 2499},
            }
        }
    })

    assert public["premium"]["offer_prices"] == {"monthly": 799.0}
    assert "razorpay_offer_ids" not in public["premium"]


def test_admin_pricing_rejects_offer_prices_not_below_regular_price():
    with pytest.raises(HTTPException) as exc:
        server._normalize_pricing_offer_prices({
            "premium": {
                "monthly": 999,
                "quarterly": 2499,
                "yearly": 7999,
                "offer_prices": {"monthly": 999},
            }
        })

    assert exc.value.status_code == 400


def test_custom_first_period_price_requires_a_razorpay_offer_id():
    membership = {
        "plans": {
            "premium": {"enabled": True},
            "pro": {"enabled": False},
        },
        "early_access": {"enabled": False, "discount_percent": 0},
    }
    config = {
        "razorpay": {
            "enabled": True,
            "key_id_enc": "key_id",
            "key_secret_enc": "key_secret",
            "webhook_secret_enc": "webhook_secret",
        },
        "pricing": {
            "premium": {
                "monthly": 999,
                "quarterly": 2499,
                "yearly": 7999,
                "offer_prices": {"monthly": 799},
                "razorpay_plan_ids": {
                    "monthly": "plan_monthly",
                    "quarterly": "plan_quarterly",
                    "yearly": "plan_yearly",
                },
            }
        },
    }

    assert server._billing_readiness(config, membership)["offer_ids_ready"] is False


def test_checkout_attaches_offer_and_records_first_period_price(monkeypatch):
    saved = {}
    collections = SimpleNamespace(member_subscriptions=Collection(), members=Collection())
    monkeypatch.setattr(server, "db", collections)
    monkeypatch.setattr(server, "_decrypt_safe", lambda value: value)
    monkeypatch.setattr(server, "_record_member_audit", _async_noop)
    monkeypatch.setattr(server, "_member_context", _member_context)
    monkeypatch.setattr(server, "_load_platform_config", _platform_config)

    class Response:
        def __init__(self, body):
            self.body = body

        def raise_for_status(self):
            return None

        def json(self):
            return self.body

    class Client:
        def __init__(self, **_kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        async def get(self, _url):
            return Response({"item": {"amount": 99900, "currency": "INR"}})

        async def post(self, _url, *, json):
            saved["request_body"] = json
            return Response({"id": "sub-123", "short_url": "https://checkout.test/sub-123"})

    monkeypatch.setattr("httpx.AsyncClient", Client)
    request = Request({
        "type": "http",
        "method": "POST",
        "path": "/api/billing/checkout",
        "headers": [],
        "query_string": b"",
        "server": ("test", 443),
        "scheme": "https",
        "client": ("127.0.0.1", 1234),
    })

    result = asyncio.run(server.membership_checkout(
        {"plan": "premium", "cadence": "monthly"},
        request,
    ))

    assert saved["request_body"]["offer_id"] == "offer_monthly"
    assert result["regular_price"] == 999
    assert result["first_period_price"] == 799
    subscription_update = collections.member_subscriptions.updated[0][1]["$set"]
    assert subscription_update["first_period_price"] == 799
    assert subscription_update["offer_id"] == "offer_monthly"


async def _async_noop(*_args, **_kwargs):
    return None


async def _member_context(_request):
    return (
        {
            "member_id": "member-123",
            "member": {"_id": "member-123", "plan": "normal", "subscription": {}},
        },
        {
            "paid_subscriptions_enabled": True,
            "plans": {
                "premium": {"enabled": True},
                "pro": {"enabled": False},
            },
            "early_access": {"enabled": False, "discount_percent": 0},
        },
        "normal",
    )


async def _platform_config():
    return {
        "razorpay": {
            "enabled": True,
            "key_id_enc": "key_id",
            "key_secret_enc": "key_secret",
            "webhook_secret_enc": "webhook_secret",
        },
        "pricing": {
            "currency": "INR",
            "premium": {
                "monthly": 999,
                "quarterly": 2499,
                "yearly": 7999,
                "offer_prices": {"monthly": 799, "quarterly": "", "yearly": ""},
                "razorpay_plan_ids": {
                    "monthly": "plan_monthly",
                    "quarterly": "plan_quarterly",
                    "yearly": "plan_yearly",
                },
                "razorpay_offer_ids": {
                    "monthly": "offer_monthly",
                    "quarterly": "",
                    "yearly": "",
                },
            },
        },
    }
