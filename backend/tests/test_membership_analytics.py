from datetime import date, datetime, timedelta, timezone
import asyncio
from types import SimpleNamespace
import httpx

import pytest
from fastapi.testclient import TestClient
from starlette.requests import Request

from membership_analytics import (
    analytics_date_range,
    build_membership_analytics,
    sanitize_signup_attribution,
    verified_payment_fields,
)
import server


def test_signup_attribution_keeps_campaign_labels_and_referrer_host_only():
    result = sanitize_signup_attribution({
        "utm_source": "  campaign\x00-A  ",
        "utm_medium": "email",
        "utm_campaign": "x" * 120,
        "utm_term": 42,
        "referrer": "https://News.Example/path/private?email=user@example.test",
        "unexpected": "must not persist",
    })

    assert result == {
        "utm_source": "campaign-A",
        "utm_medium": "email",
        "utm_campaign": "x" * 100,
        "referrer_host": "news.example",
    }


def test_signup_attribution_rejects_non_web_referrers_and_payment_fields_are_bounded():
    assert sanitize_signup_attribution({"referrer": "javascript:alert(1)"}) == {}
    assert verified_payment_fields({
        "id": "pay-1",
        "amount": 15000,
        "amount_refunded": "500",
        "currency": "inr",
        "method": "card",
    }) == {
        "payment_id": "pay-1",
        "currency": "INR",
        "amount_minor": 15000,
        "refunded_amount_minor": 500,
    }
    assert verified_payment_fields({
        "id": "pay-2",
        "amount": 100.5,
        "amount_refunded": True,
        "currency": "INR",
    }) == {"payment_id": "pay-2", "currency": "INR"}


def test_analytics_date_range_defaults_to_last_seven_indian_calendar_days():
    now = datetime(2026, 10, 30, 12, 0, tzinfo=timezone.utc)

    start_day, end_day, start, end = analytics_date_range(now=now)

    assert (start_day, end_day) == (date(2026, 10, 24), date(2026, 10, 30))
    assert start == datetime(2026, 10, 23, 18, 30, tzinfo=timezone.utc)
    assert end == datetime(2026, 10, 30, 18, 30, tzinfo=timezone.utc)


@pytest.mark.parametrize(
    ("from_value", "to_value", "days_value", "message"),
    [
        ("2026-10-31", "2026-10-30", None, "on or after"),
        ("2025-10-29", "2026-10-30", None, "cannot exceed"),
        (None, "2026-10-30", 0, "day range"),
        ("10/01/2026", "2026-10-30", None, "YYYY-MM-DD"),
    ],
)
def test_analytics_date_range_rejects_invalid_ranges(from_value, to_value, days_value, message):
    with pytest.raises(ValueError, match=message):
        analytics_date_range(from_value, to_value, days_value, now=datetime(2026, 10, 30, tzinfo=timezone.utc))


def test_membership_analytics_uses_verified_amounts_and_current_subscription_state():
    now = datetime(2026, 10, 30, 12, 0, tzinfo=timezone.utc)
    current_end = (now + timedelta(days=30)).timestamp()
    members = [
        {
            "_id": "premium-member",
            "name": "Premium",
            "email": "premium@example.test",
            "plan": "premium",
            "created_at": "2026-10-27T09:00:00+00:00",
            "subscription": {
                "id": "sub-premium",
                "plan": "premium",
                "status": "active",
                "current_end": current_end,
            },
            "acquisition": {"utm_source": "google"},
        },
        {
            "_id": "cancelled-member",
            "name": "Cancelled",
            "plan": "normal",
            "created_at": "2026-10-28T09:00:00+00:00",
            "subscription": {"id": "sub-old", "plan": "pro", "status": "cancelled"},
        },
        {
            "_id": "basic-member",
            "plan": "normal",
            "created_at": "2026-10-30T09:00:00+00:00",
        },
        {
            "_id": "quarterly-pro",
            "plan": "pro",
            "created_at": "2026-10-29T09:00:00+00:00",
            "subscription": {
                "id": "sub-pro",
                "plan": "pro",
                "status": "active",
                "current_end": current_end,
            },
        },
        {
            "_id": "override-premium",
            "plan": "premium",
            "admin_plan_override": True,
            "created_at": "2026-10-25T09:00:00+00:00",
            "subscription": {
                "id": "sub-override",
                "plan": "premium",
                "status": "active",
                "current_end": current_end,
            },
        },
        {
            "_id": "payment-risk",
            "plan": "normal",
            "created_at": "2026-10-10T09:00:00+00:00",
            "subscription": {"plan": "premium", "status": "past_due"},
        },
        {
            "_id": "suspended-paying-member",
            "plan": "normal",
            "disabled_at": "2026-10-20T09:00:00+00:00",
            "created_at": "2026-10-01T09:00:00+00:00",
            "subscription": {
                "id": "sub-suspended",
                "plan": "premium",
                "status": "active",
                "current_end": current_end,
            },
        },
    ]
    subscriptions = [
        {
            "_id": "sub-premium",
            "user_id": "premium-member",
            "plan": "premium",
            "cadence": "monthly",
            "status": "active",
            "current_end": current_end,
            "first_paid_at": datetime(2026, 10, 27, 21, 0, tzinfo=timezone.utc).timestamp(),
        },
        {
            "_id": "sub-old",
            "user_id": "cancelled-member",
            "plan": "pro",
            "cadence": "yearly",
            "status": "cancelled",
        },
        {
            "_id": "sub-pro",
            "user_id": "quarterly-pro",
            "plan": "pro",
            "cadence": "quarterly",
            "status": "active",
            "current_end": current_end,
        },
        {
            "_id": "sub-override",
            "user_id": "override-premium",
            "plan": "premium",
            "cadence": "monthly",
            "status": "active",
            "current_end": current_end,
        },
        {
            "_id": "sub-suspended",
            "user_id": "suspended-paying-member",
            "plan": "premium",
            "cadence": "monthly",
            "status": "active",
            "current_end": current_end,
        },
    ]
    billing_events = [
        {
            "_id": "charge",
            "event_type": "subscription.charged",
            "subscription_id": "sub-premium",
            "payment_id": "pay-1",
            "amount_minor": 125000,
            "currency": "INR",
            "event_created_at": datetime(2026, 10, 27, 21, 0, tzinfo=timezone.utc).timestamp(),
        },
        {
            "_id": "charge-duplicate",
            "event_type": "subscription.charged",
            "subscription_id": "sub-premium",
            "payment_id": "pay-1",
            "amount_minor": 125000,
            "currency": "INR",
            "event_created_at": datetime(2026, 10, 27, 21, 1, tzinfo=timezone.utc).timestamp(),
        },
        {
            "_id": "refund-partial",
            "event_type": "payment.refunded",
            "subscription_id": "sub-premium",
            "payment_id": "pay-1",
            "refunded_amount_minor": 2500,
            "currency": "INR",
            "event_created_at": datetime(2026, 10, 28, 21, 0, tzinfo=timezone.utc).timestamp(),
        },
        {
            "_id": "refund-final",
            "event_type": "payment.refunded",
            "subscription_id": "sub-premium",
            "payment_id": "pay-1",
            "refunded_amount_minor": 5000,
            "currency": "INR",
            "event_created_at": datetime(2026, 10, 29, 21, 0, tzinfo=timezone.utc).timestamp(),
        },
        {
            "_id": "refund-old-payment",
            "event_type": "payment.refunded",
            "subscription_id": "sub-premium",
            "payment_id": "pay-old",
            "refunded_amount_minor": 2500,
            "currency": "INR",
            "event_created_at": datetime(2026, 10, 28, 21, 0, tzinfo=timezone.utc).timestamp(),
        },
        {
            "_id": "failed",
            "event_type": "payment.failed",
            "subscription_id": "sub-premium",
            "event_created_at": datetime(2026, 10, 28, 9, 0, tzinfo=timezone.utc).timestamp(),
        },
        {
            "_id": "cancel",
            "event_type": "subscription.cancelled",
            "subscription_id": "sub-old",
            "event_created_at": datetime(2026, 10, 29, 9, 0, tzinfo=timezone.utc).timestamp(),
        },
    ]

    result = build_membership_analytics(
        members=members,
        subscriptions=subscriptions,
        checkout_audits=[{
            "member_id": "premium-member",
            "created_at": datetime(2026, 10, 28, 9, 0, tzinfo=timezone.utc),
        }],
        billing_events=billing_events,
        prior_refund_events=[{
            "_id": "refund-old-payment-baseline",
            "event_type": "payment.refunded",
            "payment_id": "pay-old",
            "refunded_amount_minor": 2000,
            "currency": "INR",
            "event_created_at": datetime(2026, 10, 20, 21, 0, tzinfo=timezone.utc).timestamp(),
        }],
        cancellation_audits=[{
            "created_at": datetime(2026, 10, 29, 9, 0, tzinfo=timezone.utc),
            "details": {"reason": "price"},
        }, {
            "created_at": datetime(2026, 10, 29, 10, 0, tzinfo=timezone.utc),
            "details": {"reason": "unexpected-value"},
        }],
        membership_config={
            "experience_enabled": True,
            "plans": {
                "normal": {"enabled": True},
                "premium": {"enabled": True},
                "pro": {"enabled": True},
            },
        },
        pricing_config={
            "currency": "INR",
            "premium": {"monthly": 999},
            "pro": {"quarterly": 3000, "yearly": 12000},
        },
        start_day=date(2026, 10, 24),
        end_day=date(2026, 10, 30),
        effective_member_plan=lambda member, _now: member.get("plan", "normal"),
        now=now,
    )

    assert result["funnel"] == {
        "signups": 5,
        "checkout_started": 1,
        "paid": 1,
        "signup_to_checkout_rate": 20.0,
        "signup_to_paid_rate": 20.0,
    }
    assert result["current"]["members_by_plan"] == {"normal": 3, "premium": 2, "pro": 1}
    assert result["current"]["active_paid_subscriptions"] == 3
    assert result["current"]["payment_attention_count"] == 1
    assert result["current"]["estimated_mrr"] == 2998
    assert "suspended accounts" in result["current"]["estimated_mrr_note"]
    assert result["revenue"]["gross_collected_minor"] == 125000
    assert result["revenue"]["refunded_minor"] == 5500
    assert result["revenue"]["net_collected_minor"] == 119500
    assert result["monthly_reconciliation"] == [{
        "month": "2026-10",
        "coverage_from": "2026-10-24",
        "coverage_to": "2026-10-30",
        "successful_charges": 1,
        "charges_with_amounts": 1,
        "gross_collected_minor": 125000,
        "refund_increases": 3,
        "refunded_minor": 5500,
        "net_collected_minor": 119500,
    }]
    assert "not a period churn rate" in result["paid_cohort_note"]
    assert "no renewal" in result["charge_note"]
    assert result["cancellation_reasons"] == [
        {"reason": "not_provided", "count": 1},
        {"reason": "price", "count": 1},
    ]
    assert result["acquisition"] == [
        {"source": "Unknown / not tracked", "signups": 4},
        {"source": "google", "signups": 1},
    ]
    assert result["recent_signups"][0]["id"] == "basic-member"
    assert result["paid_cohorts"][-1] == {
        "month": "2026-10",
        "paid_members": 1,
        "active_now": 1,
        "not_active_now": 0,
        "retention_rate": 100.0,
        "not_active_rate": 0.0,
    }
    assert sum(row["charges"] for row in result["daily"]) == 1


def test_signup_funnel_includes_later_paid_conversion_without_adding_out_of_range_revenue():
    result = build_membership_analytics(
        members=[{
            "_id": "member-1",
            "plan": "pro",
            "created_at": "2026-10-29T09:00:00+00:00",
            "subscription": {
                "id": "sub-1",
                "plan": "pro",
                "status": "active",
                "current_end": (datetime(2026, 11, 30, tzinfo=timezone.utc)).timestamp(),
            },
        }],
        subscriptions=[{
            "_id": "sub-1",
            "user_id": "member-1",
            "plan": "pro",
            "cadence": "monthly",
            "status": "active",
            "current_end": datetime(2026, 11, 30, tzinfo=timezone.utc).timestamp(),
        }],
        checkout_audits=[],
        billing_events=[],
        cohort_charge_events=[{"subscription_id": "sub-1"}],
        cancellation_audits=[],
        membership_config={"experience_enabled": True, "plans": {"pro": {"enabled": True}}},
        pricing_config={"currency": "INR"},
        start_day=date(2026, 10, 29),
        end_day=date(2026, 10, 29),
        effective_member_plan=lambda member, _now: member.get("plan", "normal"),
        now=datetime(2026, 10, 30, 12, 0, tzinfo=timezone.utc),
    )

    assert result["funnel"]["signups"] == 1
    assert result["funnel"]["paid"] == 1
    assert result["daily"] == [{
        "date": "2026-10-29",
        "signups": 1,
        "checkouts": 0,
        "charges": 0,
        "gross_revenue_minor": 0,
        "refunds_minor": 0,
        "net_revenue_minor": 0,
        "cancellations": 0,
        "failed_payments": 0,
    }]


class Cursor:
    def __init__(self, rows):
        self.rows = rows

    async def to_list(self, length=None):
        return self.rows if length is None else self.rows[:length]


class Collection:
    def __init__(self, rows):
        self.rows = rows
        self.query = None
        self.queries = []

    def find(self, query, projection):
        self.query = query
        self.queries.append(query)
        return Cursor(self.rows)


def test_admin_analytics_endpoint_loads_bounded_fields_and_returns_range(monkeypatch):
    members = Collection([{
        "_id": f"member-{index}",
        "plan": "normal",
        "created_at": "2026-10-30T09:00:00+00:00",
    } for index in range(501)])
    subscriptions = Collection([{"_id": "sub-1", "user_id": "member-1"}])
    checkouts = Collection([])
    billing = Collection([])

    async def platform_config():
        return {"membership": {"experience_enabled": True}}

    monkeypatch.setattr(server, "db", SimpleNamespace(
        members=members,
        member_subscriptions=subscriptions,
        member_audit=checkouts,
        billing_events=billing,
    ))
    monkeypatch.setattr(server, "_load_platform_config", platform_config)

    result = asyncio.run(server.admin_membership_analytics(
        from_date="2026-10-30",
        to_date="2026-10-30",
    ))

    assert result["date_range"] == {"from": "2026-10-30", "to": "2026-10-30"}
    assert result["funnel"]["signups"] == 501
    assert len(result["recent_signups"]) == 50
    assert result["recent_signups_truncated"] == 451
    assert billing.queries[0]["subscription_id"] == {"$in": ["sub-1"]}
    period_billing_query = billing.queries[1]
    assert period_billing_query["event_type"]["$in"] == [
        "subscription.charged",
        "subscription.cancelled",
        "payment.failed",
        "payment.refunded",
    ]
    assert period_billing_query["$or"][0]["event_created_at"] == {
        "$gte": int(datetime(2026, 10, 29, 18, 30, tzinfo=timezone.utc).timestamp()),
        "$lt": int(datetime(2026, 10, 30, 18, 30, tzinfo=timezone.utc).timestamp()),
    }
    assert checkouts.queries[0]["created_at"] == {
        "$gte": datetime(2026, 10, 29, 18, 30, tzinfo=timezone.utc),
        "$lt": datetime(2026, 10, 30, 18, 30, tzinfo=timezone.utc),
    }
    assert result["performance"]["documents_read"]["members"] == 501
    assert result["performance"]["total_documents_read"] == 502
    assert result["cancellation_reasons"] == []


def test_admin_analytics_route_rejects_anonymous_requests():
    response = TestClient(server.app).get("/api/admin/membership-analytics")
    assert response.status_code == 401


def test_google_exchange_saves_sanitized_attribution_only_for_new_members(monkeypatch):
    class Members:
        def __init__(self, existing=None):
            self.existing = existing
            self.updated = []

        async def find_one(self, query, _projection=None):
            if self.existing and query.get("_id") == self.existing.get("_id"):
                return self.existing
            return None

        async def update_one(self, query, update, upsert=False):
            self.updated.append((query, update, upsert))

    class MemberSessions:
        def __init__(self):
            self.inserted = []

        async def insert_one(self, _document):
            self.inserted.append(_document)
            return None

    class Response:
        def __init__(self, data):
            self.data = data

        def raise_for_status(self):
            return None

        def json(self):
            return self.data

    class Client:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return False

        async def post(self, *_args, **_kwargs):
            return Response({"access_token": "temporary-access"})

        async def get(self, *_args, **_kwargs):
            return Response({
                "email": "new@example.test",
                "sub": "google-subject",
                "email_verified": True,
                "name": "New Member",
            })

    def request():
        async def receive():
            return {"type": "http.request", "body": b"", "more_body": False}

        return Request({
            "type": "http",
            "method": "POST",
            "path": "/api/auth/google/exchange",
            "headers": [],
            "query_string": b"",
            "server": ("striklenz.com", 443),
            "scheme": "https",
            "client": ("127.0.0.1", 1234),
        }, receive)

    async def platform_config():
        return {
            "google": {
                "enabled": True,
                "client_id_enc": "client-id",
                "client_secret_enc": "client-secret",
            },
            "membership": {"experience_enabled": True, "signup_enabled": True},
        }

    monkeypatch.setattr(server, "_load_platform_config", platform_config)
    monkeypatch.setattr(server, "_decrypt_safe", lambda value: value)
    monkeypatch.setattr(httpx, "AsyncClient", Client)

    new_members = Members()
    new_sessions = MemberSessions()
    monkeypatch.setattr(server, "db", SimpleNamespace(
        members=new_members,
        member_sessions=new_sessions,
    ))
    first_login = asyncio.run(server.google_exchange({
        "code": "one-time-code",
        "redirect_uri": "https://striklenz.com/login",
        "attribution": {
            "utm_source": "newsletter",
            "referrer": "https://news.example/article?email=private@example.test",
        },
    }, request()))
    new_fields = new_members.updated[0][1]["$setOnInsert"]
    assert new_fields["acquisition"] == {
        "utm_source": "newsletter",
        "referrer_host": "news.example",
    }
    assert first_login["is_member"] is True
    assert first_login["email"] == "new@example.test"
    assert new_sessions.inserted[0]["user_id"] == "google-subject"

    existing_members = Members({"_id": "google-subject", "acquisition": {"utm_source": "original"}})
    repeat_sessions = MemberSessions()
    monkeypatch.setattr(server, "db", SimpleNamespace(
        members=existing_members,
        member_sessions=repeat_sessions,
    ))
    repeat_login = asyncio.run(server.google_exchange({
        "code": "one-time-code",
        "redirect_uri": "https://striklenz.com/login",
        "attribution": {"utm_source": "later-login"},
    }, request()))
    existing_fields = existing_members.updated[0][1]["$set"]
    assert "acquisition" not in existing_fields
    assert "$setOnInsert" not in existing_members.updated[0][1]
    assert repeat_login["is_member"] is True
    assert repeat_login["email"] == "new@example.test"
    assert repeat_sessions.inserted[0]["user_id"] == new_sessions.inserted[0]["user_id"]
    assert repeat_login["member_token"] != first_login["member_token"]
