import asyncio
from types import SimpleNamespace

import server


class Cursor:
    def __init__(self, rows):
        self.rows = rows

    async def to_list(self, length=None):
        return self.rows if length is None else self.rows[:length]


class Members:
    def __init__(self, rows):
        self.rows = rows

    def find(self, query, projection):
        return Cursor(self.rows)


class BillingEvents:
    def __init__(self, rows):
        self.rows = rows

    async def count_documents(self, query):
        return sum(row.get("event_type") == query["event_type"] for row in self.rows)


def test_admin_subscription_health_reports_current_access_and_all_time_billing(monkeypatch):
    future_end = (server.datetime.now(server.timezone.utc)).timestamp() + 86400
    members = [
        {"_id": "basic", "name": "Basic member", "email": "basic@example.test", "plan": "normal"},
        {"_id": "active-premium", "plan": "premium", "subscription": {"status": "active", "current_end": future_end}},
        {"_id": "active-pro", "plan": "pro", "subscription": {"status": "active", "current_end": future_end}},
        {
            "_id": "failed-payment",
            "name": "Failed member",
            "email": "failed@example.test",
            "plan": "premium",
            "subscription": {"plan": "premium", "status": "past_due", "current_end": future_end},
        },
        {"_id": "cancelled", "plan": "pro", "subscription": {"status": "cancelled", "current_end": future_end}},
        {"_id": "suspended", "plan": "pro", "disabled_at": "suspended", "subscription": {"status": "active", "current_end": future_end}},
        {
            "_id": "expired",
            "plan": "premium",
            "subscription": {"plan": "premium", "status": "active", "current_end": future_end - 172800},
        },
    ]
    billing_events = [
        {"event_type": "subscription.charged"},
        {"event_type": "subscription.charged"},
        {"event_type": "subscription.cancelled"},
        {"event_type": "payment.failed"},
        {"event_type": "unrelated"},
    ]

    async def platform_config():
        return {
            "membership": {
                "experience_enabled": True,
                "plans": {
                    "normal": {"enabled": False},
                    "premium": {"enabled": True},
                    "pro": {"enabled": True},
                },
            },
        }

    monkeypatch.setattr(server, "db", SimpleNamespace(
        members=Members(members),
        billing_events=BillingEvents(billing_events),
    ))
    monkeypatch.setattr(server, "_load_platform_config", platform_config)

    result = asyncio.run(server.admin_subscription_health())

    assert result == {
        "active_members_by_plan": {"normal": 0, "premium": 1, "pro": 1},
        "all_time": {"renewals": 2, "cancellations": 1, "failed_payments": 1},
        "blocked_basic_members": 4,
        "blocked_basic_member_list": [
            {"id": "basic", "name": "Basic member", "email": "basic@example.test", "payment_status": None},
            {"id": "failed-payment", "name": "Failed member", "email": "failed@example.test", "payment_status": "past_due"},
            {"id": "cancelled", "name": None, "email": None, "payment_status": "cancelled"},
            {"id": "expired", "name": None, "email": None, "payment_status": "active"},
        ],
        "blocked_basic_members_truncated": 0,
        "payment_attention_members": [
            {
                "id": "failed-payment",
                "name": "Failed member",
                "email": "failed@example.test",
                "plan": "premium",
                "payment_status": "past_due",
                "updated_at": None,
            },
            {
                "id": "expired",
                "name": None,
                "email": None,
                "plan": "premium",
                "payment_status": "expired",
                "updated_at": None,
            },
        ],
        "payment_attention_members_count": 2,
        "payment_attention_members_truncated": 0,
        "basic_plan_enabled": False,
        "membership_experience_enabled": True,
    }


def test_admin_health_caps_lists_flags_stale_pending_and_recovers_basic_access(monkeypatch):
    stale_checkout = (
        server.datetime.now(server.timezone.utc) - server.timedelta(hours=1)
    ).isoformat()
    members = [
        {"_id": f"basic-{index}", "plan": "normal"}
        for index in range(53)
    ] + [
        {
            "_id": "stale-checkout",
            "name": "Pending checkout",
            "email": "pending@example.test",
            "plan": "normal",
            "subscription": {
                "plan": "pro",
                "status": "created",
                "updated_at": stale_checkout,
            },
        },
        {
            "_id": "suspended-failure",
            "name": "Suspended failed member",
            "plan": "normal",
            "disabled_at": "suspended",
            "subscription": {"plan": "premium", "status": "past_due"},
        },
    ]
    config_state = {"basic_enabled": False}

    async def platform_config():
        return {
            "membership": {
                "experience_enabled": True,
                "plans": {
                    "normal": {"enabled": config_state["basic_enabled"]},
                    "premium": {"enabled": True},
                    "pro": {"enabled": True},
                },
            },
        }

    monkeypatch.setattr(server, "db", SimpleNamespace(
        members=Members(members),
        billing_events=BillingEvents([]),
    ))
    monkeypatch.setattr(server, "_load_platform_config", platform_config)

    blocked = asyncio.run(server.admin_subscription_health())
    assert blocked["blocked_basic_members"] == 54
    assert len(blocked["blocked_basic_member_list"]) == 50
    assert blocked["blocked_basic_members_truncated"] == 4
    assert {row["id"] for row in blocked["payment_attention_members"]} == {
        "stale-checkout",
        "suspended-failure",
    }
    assert blocked["payment_attention_members_count"] == 2
    assert blocked["payment_attention_members"][0]["payment_status"] == "created"

    config_state["basic_enabled"] = True
    restored = asyncio.run(server.admin_subscription_health())
    assert restored["blocked_basic_members"] == 0
    assert restored["blocked_basic_member_list"] == []
    assert restored["active_members_by_plan"]["normal"] == 54
