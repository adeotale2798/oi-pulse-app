"""Pure aggregation helpers for the Admin membership analytics surface."""

import re
from datetime import date, datetime, time, timedelta, timezone
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo


IST = ZoneInfo("Asia/Kolkata")
_ATTRIBUTION_FIELDS = ("utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term")
_AMOUNT_LIMIT = 10**15
_PAID_PLAN_CADENCE_MONTHS = {"monthly": 1, "quarterly": 3, "yearly": 12}


def sanitize_signup_attribution(value):
    """Keep only short campaign labels and a referrer host, never a full URL."""
    if not isinstance(value, dict):
        return {}

    sanitized = {}
    for field in _ATTRIBUTION_FIELDS:
        raw = value.get(field)
        if not isinstance(raw, str):
            continue
        clean = re.sub(r"[\x00-\x1f\x7f]", "", raw).strip()[:100]
        if clean:
            sanitized[field] = clean

    referrer = value.get("referrer")
    if isinstance(referrer, str):
        try:
            parsed = urlsplit(referrer.strip())
            host = (parsed.hostname or "").lower().rstrip(".")
            if parsed.scheme in {"http", "https"} and host and len(host) <= 253:
                sanitized["referrer_host"] = host
        except ValueError:
            pass
    elif isinstance(value.get("referrer_host"), str):
        host = value["referrer_host"].strip().lower().rstrip(".")
        if host and len(host) <= 253 and re.fullmatch(r"[a-z0-9.-]+", host):
            sanitized["referrer_host"] = host
    return sanitized


def analytics_date_range(from_value=None, to_value=None, days_value=None, now=None):
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    today = now.astimezone(IST).date()
    if from_value and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", from_value):
        raise ValueError("Dates must use YYYY-MM-DD format")
    if to_value and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", to_value):
        raise ValueError("Dates must use YYYY-MM-DD format")
    try:
        end_day = date.fromisoformat(to_value) if to_value else today
        start_day = date.fromisoformat(from_value) if from_value else None
    except (TypeError, ValueError) as exc:
        raise ValueError("Dates must use YYYY-MM-DD format") from exc
    if start_day is None and days_value is not None:
        try:
            days = int(days_value)
        except (TypeError, ValueError, OverflowError) as exc:
            raise ValueError("The day range must be between 1 and 366 days") from exc
        if not 1 <= days <= 366:
            raise ValueError("The day range must be between 1 and 366 days")
        start_day = end_day - timedelta(days=days - 1)
    elif start_day is None:
        start_day = end_day - timedelta(days=6)
    if end_day < start_day:
        raise ValueError("The end date must be on or after the start date")
    if (end_day - start_day).days > 365:
        raise ValueError("Date ranges cannot exceed 366 days")
    if end_day > today:
        raise ValueError("The end date cannot be in the future")
    start = datetime.combine(start_day, time.min, tzinfo=IST).astimezone(timezone.utc)
    end = datetime.combine(end_day + timedelta(days=1), time.min, tzinfo=IST).astimezone(timezone.utc)
    return start_day, end_day, start, end


def _as_datetime(value):
    if isinstance(value, datetime):
        parsed = value
    elif isinstance(value, (int, float)) and not isinstance(value, bool):
        try:
            parsed = datetime.fromtimestamp(value, timezone.utc)
        except (OverflowError, OSError, ValueError):
            return None
    elif isinstance(value, str):
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
    else:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _minor_units(value):
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        amount = value
    elif isinstance(value, str) and value.isdigit():
        try:
            amount = int(value)
        except (ValueError, OverflowError):
            return None
    else:
        return None
    if amount < 0 or amount > _AMOUNT_LIMIT:
        return None
    return amount


def verified_payment_fields(payment):
    """Persist only bounded payment identifiers, minor-unit amounts, and currency."""
    if not isinstance(payment, dict):
        return {}
    fields = {}
    payment_id = payment.get("id")
    if isinstance(payment_id, str) and 0 < len(payment_id) <= 100:
        fields["payment_id"] = payment_id
    currency = payment.get("currency")
    if isinstance(currency, str) and re.fullmatch(r"[A-Za-z]{3}", currency):
        fields["currency"] = currency.upper()
    amount = _minor_units(payment.get("amount"))
    if amount is not None and amount > 0:
        fields["amount_minor"] = amount
    refunded = _minor_units(payment.get("amount_refunded"))
    if refunded is not None:
        fields["refunded_amount_minor"] = refunded
    return fields


def _in_range(value, start, end):
    parsed = _as_datetime(value)
    return parsed if parsed and start <= parsed < end else None


def signup_member_ids_in_range(members, start, end):
    return {
        str(member["_id"])
        for member in members
        if member.get("_id") is not None
        and _in_range(member.get("created_at"), start, end)
    }


def _event_datetime(event):
    return _as_datetime(event.get("event_created_at")) or _as_datetime(event.get("received_at"))


def _valid_event_amount(event, key):
    amount = _minor_units(event.get(key))
    currency = str(event.get("currency") or "").upper()
    if amount is None or not re.fullmatch(r"[A-Z]{3}", currency):
        return None, None
    return amount, currency


def _is_active_paid_member(member, subscriptions_by_id, now):
    # Admin-granted entitlements are not evidence of recurring customer revenue.
    if member.get("admin_plan_override"):
        return None
    current = member.get("subscription") or {}
    subscription_id = current.get("id")
    stored = subscriptions_by_id.get(subscription_id) if subscription_id else None
    if not stored:
        return None
    if current.get("status") != "active" or stored.get("status") != "active":
        return None
    end = _as_datetime(current.get("current_end") or stored.get("current_end"))
    if not end or end <= now:
        return None
    plan = stored.get("plan") or current.get("plan")
    cadence = stored.get("cadence") or current.get("cadence")
    if plan not in {"premium", "pro"} or cadence not in _PAID_PLAN_CADENCE_MONTHS:
        return None
    return stored, plan, cadence


def build_membership_analytics(
    *,
    members,
    subscriptions,
    checkout_audits,
    billing_events,
    prior_refund_events=(),
    cohort_charge_events=(),
    cancellation_audits=(),
    membership_config,
    pricing_config,
    start_day,
    end_day,
    effective_member_plan,
    now=None,
):
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    now = now.astimezone(timezone.utc)
    start = datetime.combine(start_day, time.min, tzinfo=IST).astimezone(timezone.utc)
    end = datetime.combine(end_day + timedelta(days=1), time.min, tzinfo=IST).astimezone(timezone.utc)
    days = [(start_day + timedelta(days=offset)).isoformat() for offset in range((end_day - start_day).days + 1)]
    daily = {
        day: {
            "date": day,
            "signups": 0,
            "checkouts": 0,
            "charges": 0,
            "gross_revenue_minor": 0,
            "refunds_minor": 0,
            "net_revenue_minor": 0,
            "cancellations": 0,
            "failed_payments": 0,
        }
        for day in days
    }
    months = sorted({
        (start_day.replace(day=1) + timedelta(days=32 * offset)).replace(day=1).strftime("%Y-%m")
        for offset in range((end_day.year - start_day.year) * 12 + end_day.month - start_day.month + 1)
    })
    monthly_reconciliation = {
        month: {
            "month": month,
            "coverage_from": max(
                start_day,
                date.fromisoformat(f"{month}-01"),
            ).isoformat(),
            "coverage_to": min(
                end_day,
                (
                    date.fromisoformat(f"{month}-01")
                    + timedelta(days=32)
                ).replace(day=1) - timedelta(days=1),
            ).isoformat(),
            "successful_charges": 0,
            "charges_with_amounts": 0,
            "gross_collected_minor": 0,
            "refund_increases": 0,
            "refunded_minor": 0,
            "net_collected_minor": 0,
        }
        for month in months
    }

    members_by_id = {str(row.get("_id")): row for row in members if row.get("_id") is not None}
    pricing = pricing_config or {}
    report_currency = str(pricing.get("currency") or "INR").upper()
    signup_members = []
    for member in members:
        created_at = _in_range(member.get("created_at"), start, end)
        if created_at:
            signup_members.append((created_at, member))
            daily[created_at.astimezone(IST).date().isoformat()]["signups"] += 1
    signup_ids = {str(member.get("_id")) for _, member in signup_members}

    checkout_members = set()
    for audit in checkout_audits:
        member_id = str(audit.get("member_id") or "")
        created_at = _in_range(audit.get("created_at"), start, end)
        if created_at:
            daily[created_at.astimezone(IST).date().isoformat()]["checkouts"] += 1
        if member_id in signup_ids:
            checkout_members.add(member_id)

    subscriptions_by_id = {
        str(row.get("_id")): row for row in subscriptions if row.get("_id") is not None
    }
    member_by_subscription = {
        subscription_id: str(subscription.get("user_id"))
        for subscription_id, subscription in subscriptions_by_id.items()
        if subscription.get("user_id") is not None
    }

    cancellation_reason_counts = {}
    allowed_cancellation_reasons = {
        "price",
        "not_using",
        "missing_features",
        "technical_issue",
        "broker_setup",
        "switching",
        "other",
    }
    for audit in cancellation_audits:
        event_at = _in_range(audit.get("created_at"), start, end)
        if not event_at:
            continue
        reason = (audit.get("details") or {}).get("reason")
        key = (
            reason
            if isinstance(reason, str) and reason in allowed_cancellation_reasons
            else "not_provided"
        )
        cancellation_reason_counts[key] = cancellation_reason_counts.get(key, 0) + 1

    charge_events = []
    charge_payment_events = []
    refund_events = []
    other_currency_events = 0
    charged_members = set()
    for event in billing_events:
        event_type = event.get("event_type")
        event_at = _event_datetime(event)
        in_range_at = event_at if event_at and start <= event_at < end else None
        subscription_id = str(event.get("subscription_id") or "")
        member_id = member_by_subscription.get(subscription_id)
        if event_type == "subscription.charged":
            if member_id:
                charged_members.add(member_id)
            payment_id = event.get("payment_id")
            if payment_id and event_at:
                charge_payment_events.append((event_at, str(payment_id)))
            amount, currency = _valid_event_amount(event, "amount_minor")
            if amount is not None and currency != report_currency and in_range_at:
                other_currency_events += 1
            if amount is not None and currency == report_currency and event.get("payment_id") and event_at:
                charge_events.append((event_at, str(event["payment_id"]), amount))
        elif event_type == "payment.refunded":
            amount, currency = _valid_event_amount(event, "refunded_amount_minor")
            if amount is not None and currency != report_currency and in_range_at:
                other_currency_events += 1
            if amount is not None and currency == report_currency and event.get("payment_id") and event_at:
                refund_events.append((event_at, str(event["payment_id"]), amount))
        if event_type == "subscription.cancelled" and in_range_at:
            daily[in_range_at.astimezone(IST).date().isoformat()]["cancellations"] += 1
        elif event_type == "payment.failed" and in_range_at:
            daily[in_range_at.astimezone(IST).date().isoformat()]["failed_payments"] += 1

    unique_payment_events = {}
    for event_at, payment_id in sorted(charge_payment_events):
        unique_payment_events.setdefault(payment_id, event_at)
    for event_at in unique_payment_events.values():
        if start <= event_at < end:
            day = event_at.astimezone(IST).date().isoformat()
            month = event_at.astimezone(IST).strftime("%Y-%m")
            daily[day]["charges"] += 1
            monthly_reconciliation[month]["successful_charges"] += 1

    unique_charges = {}
    for event_at, payment_id, amount in sorted(charge_events):
        unique_charges.setdefault(payment_id, (event_at, amount))
    actual_gross_minor = 0
    amount_records = 0
    for event_at, amount in unique_charges.values():
        if start <= event_at < end:
            day = event_at.astimezone(IST).date().isoformat()
            month = event_at.astimezone(IST).strftime("%Y-%m")
            actual_gross_minor += amount
            amount_records += 1
            daily[day]["gross_revenue_minor"] += amount
            monthly_reconciliation[month]["charges_with_amounts"] += 1
            monthly_reconciliation[month]["gross_collected_minor"] += amount

    # Refund webhook amounts are cumulative, so only each payment's increase is revenue reversal.
    refund_high_watermark = {}
    prior_refund_high_watermark = {}
    for event in prior_refund_events:
        event_at = _event_datetime(event)
        amount, currency = _valid_event_amount(event, "refunded_amount_minor")
        payment_id = str(event.get("payment_id") or "")
        if (
            event_at
            and event_at < start
            and amount is not None
            and currency == report_currency
            and payment_id
        ):
            prior_refund_high_watermark[payment_id] = max(
                prior_refund_high_watermark.get(payment_id, 0),
                amount,
            )
    refund_high_watermark.update(prior_refund_high_watermark)
    for event_at, payment_id, amount in sorted(refund_events):
        previous = refund_high_watermark.get(payment_id, 0)
        increment = max(0, amount - previous)
        refund_high_watermark[payment_id] = max(previous, amount)
        if increment and start <= event_at < end:
            day = event_at.astimezone(IST).date().isoformat()
            month = event_at.astimezone(IST).strftime("%Y-%m")
            daily[day]["refunds_minor"] += increment
            monthly_reconciliation[month]["refund_increases"] += 1
            monthly_reconciliation[month]["refunded_minor"] += increment
    refunds_minor = sum(row["refunds_minor"] for row in daily.values())

    for row in daily.values():
        row["net_revenue_minor"] = row["gross_revenue_minor"] - row["refunds_minor"]
    for row in monthly_reconciliation.values():
        row["net_collected_minor"] = row["gross_collected_minor"] - row["refunded_minor"]

    for event in cohort_charge_events:
        subscription_id = str(event.get("subscription_id") or "")
        member_id = member_by_subscription.get(subscription_id)
        if member_id:
            charged_members.add(member_id)
    paid_cohort_members = {member_id for member_id in charged_members if member_id in members_by_id}
    funnel_paid = paid_cohort_members & signup_ids
    current_paid_by_member = {}
    active_members_by_plan = {"normal": 0, "premium": 0, "pro": 0}
    payment_attention_count = 0
    enabled_plans = (membership_config or {}).get("plans") or {}
    experience_enabled = bool((membership_config or {}).get("experience_enabled"))
    attention_statuses = {"past_due", "halted", "paused", "refunded", "expired"}
    for member in members:
        member_id = str(member.get("_id"))
        current_paid = _is_active_paid_member(member, subscriptions_by_id, now)
        if current_paid:
            current_paid_by_member[member_id] = (current_paid[1], current_paid[2])
        if member.get("disabled_at"):
            continue
        subscription = member.get("subscription") or {}
        status = str(subscription.get("status") or "").lower()
        updated_at = _as_datetime(subscription.get("updated_at") or subscription.get("created_at"))
        pending_is_stale = (
            status in {"created", "authenticated"}
            and updated_at is not None
            and updated_at <= now - timedelta(minutes=30)
        )
        current_end = _as_datetime(subscription.get("current_end"))
        expired_active = status == "active" and current_end is not None and current_end <= now
        if status in attention_statuses or pending_is_stale or expired_active:
            payment_attention_count += 1
        plan = (
            effective_member_plan(member, now)
            if effective_member_plan
            else str(member.get("plan") or "normal")
        )
        if plan not in active_members_by_plan:
            plan = "normal"
        if experience_enabled and (enabled_plans.get(plan) or {}).get("enabled", True):
            active_members_by_plan[plan] += 1

    estimated_mrr = 0.0
    mrr_by_plan = {"premium": 0.0, "pro": 0.0}
    for plan, cadence in current_paid_by_member.values():
        try:
            price = float((pricing.get(plan) or {}).get(cadence) or 0)
        except (TypeError, ValueError):
            price = 0
        if price > 0:
            monthly = price / _PAID_PLAN_CADENCE_MONTHS[cadence]
            estimated_mrr += monthly
            mrr_by_plan[plan] += monthly

    signup_count = len(signup_members)
    checkout_count = len(checkout_members & signup_ids)
    paid_count = len(funnel_paid)
    acquisition_counts = {}
    recent_signups = []
    for created_at, member in sorted(signup_members, key=lambda row: row[0], reverse=True):
        attribution = sanitize_signup_attribution(member.get("acquisition"))
        source = (
            attribution.get("utm_source")
            or attribution.get("referrer_host")
            or "Unknown / not tracked"
        )
        acquisition_counts[source] = acquisition_counts.get(source, 0) + 1
        subscription = member.get("subscription") or {}
        recent_signups.append({
            "id": str(member.get("_id")),
            "name": member.get("name"),
            "email": member.get("email"),
            "created_at": created_at.isoformat(),
            "plan": member.get("plan") or "normal",
            "account_suspended": bool(member.get("disabled_at")),
            "subscription_status": subscription.get("status") or "none",
            "subscription_plan": subscription.get("plan"),
            "effective_plan": (
                effective_member_plan(member, now)
                if effective_member_plan
                else str(member.get("plan") or "normal")
            ),
            "acquisition": attribution,
        })

    member_first_paid = {}
    for subscription in subscriptions:
        member_id = str(subscription.get("user_id") or "")
        paid_at = _as_datetime(subscription.get("first_paid_at"))
        if not paid_at or member_id not in members_by_id:
            continue
        if member_id not in member_first_paid or paid_at < member_first_paid[member_id]:
            member_first_paid[member_id] = paid_at
    first_paid_by_month = {}
    for member_id, paid_at in member_first_paid.items():
        month = paid_at.astimezone(IST).strftime("%Y-%m")
        first_paid_by_month.setdefault(month, set()).add(member_id)
    recent_months = []
    current_month = now.astimezone(IST).date().replace(day=1)
    for offset in range(11, -1, -1):
        month_index = current_month.month - 1 - offset
        year = current_month.year + month_index // 12
        month = month_index % 12 + 1
        key = f"{year:04d}-{month:02d}"
        cohort_ids = first_paid_by_month.get(key, set())
        retained = len(cohort_ids & set(current_paid_by_member))
        recent_months.append({
            "month": key,
            "paid_members": len(cohort_ids),
            "active_now": retained,
            "not_active_now": len(cohort_ids) - retained,
            "retention_rate": round(retained / len(cohort_ids) * 100, 1) if cohort_ids else None,
            "not_active_rate": round((len(cohort_ids) - retained) / len(cohort_ids) * 100, 1) if cohort_ids else None,
        })

    return {
        "date_range": {"from": start_day.isoformat(), "to": end_day.isoformat()},
        "funnel": {
            "signups": signup_count,
            "checkout_started": checkout_count,
            "paid": paid_count,
            "signup_to_checkout_rate": round(checkout_count / signup_count * 100, 1) if signup_count else None,
            "signup_to_paid_rate": round(paid_count / signup_count * 100, 1) if signup_count else None,
        },
        "current": {
            "members_by_plan": active_members_by_plan,
            "active_paid_subscriptions": len(current_paid_by_member),
            "payment_attention_count": payment_attention_count,
            "estimated_mrr": round(estimated_mrr, 2),
            "estimated_mrr_by_plan": {plan: round(amount, 2) for plan, amount in mrr_by_plan.items()},
            "estimated_mrr_note": (
                "Uses provider-active subscriptions and configured regular prices; "
                "Admin-granted entitlements are excluded, while suspended accounts with "
                "an active subscription remain included because billing may continue."
            ),
            "currency": str(pricing.get("currency") or "INR").upper(),
        },
        "revenue": {
            "currency": report_currency,
            "gross_collected_minor": actual_gross_minor,
            "refunded_minor": refunds_minor,
            "net_collected_minor": actual_gross_minor - refunds_minor,
            "amount_records": amount_records,
            "excluded_other_currency_records": other_currency_events,
            "historical_data_incomplete": True,
            "note": (
                f"Verified provider amounts are captured going forward in {report_currency}; "
                "older billing events may not include amounts, and other currencies are excluded."
            ),
            "reconciliation_note": (
                "Monthly totals are based on signature-verified, deduplicated provider events. "
                "Compare this worksheet with the provider's settlement reports; provider fees, "
                "taxes, disputes, and settlement timing are not included."
            ),
        },
        "daily": list(daily.values()),
        "monthly_reconciliation": list(monthly_reconciliation.values()),
        "cancellation_reasons": [
            {"reason": reason, "count": count}
            for reason, count in sorted(cancellation_reason_counts.items(), key=lambda row: (-row[1], row[0]))
        ],
        "acquisition": [
            {"source": source, "signups": count}
            for source, count in sorted(acquisition_counts.items(), key=lambda row: (-row[1], row[0]))
        ],
        "paid_cohorts": recent_months,
        "paid_cohort_note": (
            "Not active now is observed cohort attrition, not a period churn rate. It includes "
            "members without a current provider-active paid subscription; Admin-granted plans "
            "are excluded from recurring paid activity. Cohort history is available only where "
            "a first successful charge timestamp was recorded."
        ),
        "charge_note": (
            "Charge counts are deduplicated by provider payment ID; events without a payment ID "
            "cannot be deduplicated and are excluded. Amount coverage includes only the selected "
            "reporting currency. The event history does not reliably distinguish first charges "
            "from contractual renewals, so no renewal count is inferred."
        ),
        "recent_signups": recent_signups[:50],
        "recent_signups_total": signup_count,
        "recent_signups_truncated": max(0, signup_count - 50),
    }
