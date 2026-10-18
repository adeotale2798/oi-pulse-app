"""Index-specific exposure summaries built from retained Market Intel stories."""

from __future__ import annotations

import re
from collections import defaultdict
from datetime import date
from math import isfinite
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

from event_risk_service import INDEX_CODES, normalize_company_name, normalize_symbol

INDEX_ORDER = tuple(INDEX_CODES.values())
_NON_DISTINCTIVE_TOKENS = {
    "AND", "AXIS", "BANK", "CO", "COMPANY", "CORP", "FINANCIAL", "INDIA",
    "INDUSTRIES", "LIMITED", "LTD", "OF", "PRIVATE", "SERVICES", "THE",
}
_BROAD_CATALYST_TYPES = {"geopolitics", "india_macro", "macro", "oil"}
_DIRECT_COMPANY_EVENT = re.compile(
    r"\b(?:earnings?|results?|profits?|revenue|guidance|shares?|stock|"
    r"merger|acquisition|default|bankruptcy|fraud|regulatory|approval)\b",
    re.IGNORECASE,
)
_BANKING_CATALYST = re.compile(
    r"\b(?:bank(?:s|ing)?|credit|deposit|lending|repo|rbi|interest rates?)\b",
    re.IGNORECASE,
)
_RESULTS_NEWS = re.compile(
    r"\b(?:results?|earnings?|profit|revenue|quarterly|financial results|q[1-4])\b",
    re.IGNORECASE,
)


def _safe_int(value: Any, default: int = 0) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError, OverflowError):
        return default


def risk_level(score: Optional[int]) -> str:
    if score is None:
        return "UNASSESSED"
    if score >= 75:
        return "HIGH"
    if score >= 55:
        return "ELEVATED"
    if score >= 35:
        return "MODERATE"
    return "LOW"


def evidence_confidence(article: Dict[str, Any]) -> str:
    source_count = _safe_int(article.get("independent_source_count"), 1)
    current = article.get("news_freshness") == "CURRENT"
    published = article.get("published_at_known") is True
    agreement = article.get("source_direction_agreement")
    if source_count >= 2 and agreement == "AGREE" and current and published:
        return "HIGH"
    if source_count >= 2 or (source_count >= 1 and current and published):
        return "MEDIUM"
    return "LOW"


def _constituent_aliases(
    constituents: Sequence[Dict[str, Any]],
) -> Dict[str, List[Dict[str, Any]]]:
    token_companies: Dict[str, set] = defaultdict(set)
    for row in constituents:
        index = str(row.get("index") or "").upper()
        symbol = normalize_symbol(row.get("symbol"))
        if index not in INDEX_ORDER or not symbol:
            continue
        name = str(row.get("company_name") or row.get("company") or row.get("name") or "")
        company_key = normalize_company_name(name) or symbol
        for token in re.findall(r"[A-Z0-9]+", name.upper()):
            if len(token) >= 4 and token not in _NON_DISTINCTIVE_TOKENS:
                token_companies[token].add(company_key)

    aliases: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for row in constituents:
        index = str(row.get("index") or "").upper()
        symbol = normalize_symbol(row.get("symbol"))
        if index not in INDEX_ORDER or not symbol:
            continue
        name = str(row.get("company_name") or row.get("company") or row.get("name") or "")
        company_key = normalize_company_name(name) or symbol
        aliases[symbol].append(row)
        aliases[company_key].append(row)
        for token in token_companies:
            if token_companies[token] == {company_key} and re.search(
                rf"(?<![A-Z0-9]){re.escape(token)}(?![A-Z0-9])",
                name.upper(),
            ):
                aliases[token].append(row)
    return aliases


def _mentioned_constituents(
    article: Dict[str, Any],
    aliases: Dict[str, List[Dict[str, Any]]],
) -> List[Dict[str, Any]]:
    text = f"{article.get('title') or ''} {article.get('summary') or ''}".strip()
    normalized_text = normalize_company_name(text)
    matched: Dict[Tuple[str, str], Dict[str, Any]] = {}
    for alias, rows in aliases.items():
        if not alias:
            continue
        if alias.isdigit():
            found = bool(re.search(rf"(?<!\d){re.escape(alias)}(?!\d)", text))
        elif len(alias) <= 5 and alias.isalpha():
            found = bool(re.search(rf"(?<![A-Z0-9]){re.escape(alias)}(?![A-Z0-9])", text, re.I))
        else:
            found = alias in normalized_text
        if found:
            for row in rows:
                key = (str(row.get("index") or "").upper(), normalize_symbol(row.get("symbol")))
                matched[key] = row
    return list(matched.values())


def _article_direction(article: Dict[str, Any]) -> str:
    direction = str(article.get("market_direction") or "UNCLEAR").upper()
    return direction if direction in {"SUPPORTIVE", "NEGATIVE", "MIXED"} else "UNCLEAR"


def _confidence(article: Dict[str, Any]) -> str:
    return evidence_confidence(article)


def article_index_impacts(
    article: Dict[str, Any],
    constituents: Sequence[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """Map stories to direct constituent exposure or broad India-market catalysts."""
    aliases = _constituent_aliases(constituents)
    mentions = _mentioned_constituents(article, aliases)
    event_type = str(article.get("event_type") or "").lower()
    title_summary = f"{article.get('title') or ''} {article.get('summary') or ''}"
    base_score = max(0, min(100, _safe_int(article.get("impact_score"), 0)))
    direction = _article_direction(article)
    confidence = _confidence(article)
    impacts: Dict[str, Dict[str, Any]] = {}

    if mentions and (
        event_type == "corporate" or _DIRECT_COMPANY_EVENT.search(title_summary)
    ):
        # A multi-company headline carries the combined known index share.
        matches_by_index: Dict[str, Dict[str, Dict[str, Any]]] = defaultdict(dict)
        for row in mentions:
            index = str(row.get("index") or "").upper()
            name = str(
                row.get("company_name") or row.get("company") or row.get("name")
                or row.get("symbol")
            )
            company_key = normalize_company_name(name) or normalize_symbol(row.get("symbol"))
            matches_by_index[index][company_key] = row

        for index, index_matches in matches_by_index.items():
            known_weights = []
            names = []
            missing_weight = False
            for row in index_matches.values():
                name = str(
                    row.get("company_name") or row.get("company") or row.get("name")
                    or row.get("symbol")
                )
                names.append(name)
                try:
                    weight = float(row.get("weightage")) if row.get("weightage") is not None else None
                except (TypeError, ValueError, OverflowError):
                    weight = None
                if weight is None or not isfinite(weight) or weight < 0:
                    missing_weight = True
                else:
                    known_weights.append(weight)
            weight = sum(known_weights) if known_weights else None
            score = (
                min(100, round(base_score * min(1.0, weight / 5.0)))
                if weight is not None
                else None
            )
            if weight is None:
                reason = "Constituent news; index weight is unavailable, so exposure is unassessed."
            elif missing_weight:
                reason = (
                    f"Known combined constituent share is {weight:.2f}%; one or more "
                    "matched weights are unavailable, so total exposure may be higher."
                )
            else:
                reason = (
                    f"Constituent news; {weight:.2f}% combined known index share. "
                    "Exposure score uses article importance × min(known share ÷ 5%, 1)."
                )
            candidate = {
                "index": index,
                "risk_score": score,
                "risk_level": risk_level(score),
                "direction": direction,
                "weightage": weight,
                "exposure_type": "CONSTITUENT",
                "constituents": names,
                "reason": reason,
                "evidence_confidence": confidence,
            }
            impacts[index] = candidate

    broad_market_catalyst = (
        event_type in _BROAD_CATALYST_TYPES
        or bool(re.search(r"\b(?:nifty|sensex|bank\s*nifty|banknifty)\b", title_summary, re.I))
    )
    if broad_market_catalyst and base_score >= 50:
        for index in INDEX_ORDER:
            score = base_score
            reason = f"India-linked {event_type or 'index'} catalyst; broad index transmission."
            if index == "BANKNIFTY" and _BANKING_CATALYST.search(title_summary):
                score = min(100, score + 10)
                reason += " Banking-policy language may make BANKNIFTY more exposed."
            candidate = {
                "index": index,
                "risk_score": score,
                "risk_level": risk_level(score),
                "direction": direction,
                "weightage": None,
                "exposure_type": "BROAD_MARKET",
                "constituents": [],
                "reason": reason,
                "evidence_confidence": confidence,
            }
            previous = impacts.get(index)
            if previous is None or score > (previous.get("risk_score") or -1):
                impacts[index] = candidate

    return [impacts[index] for index in INDEX_ORDER if index in impacts]


def enrich_articles_with_index_impacts(
    articles: Iterable[Dict[str, Any]],
    constituents: Sequence[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    enriched = []
    for article in articles:
        row = dict(article)
        row["index_impacts"] = article_index_impacts(row, constituents)
        enriched.append(row)
    return enriched


def build_daily_index_risk(
    articles: Iterable[Dict[str, Any]],
    constituents: Sequence[Dict[str, Any]],
    target_date: date,
) -> Dict[str, Any]:
    unique_articles: Dict[str, Dict[str, Any]] = {}
    for article in articles:
        cluster_id = str(article.get("event_cluster_id") or article.get("id") or "")
        if cluster_id:
            unique_articles[cluster_id] = article

    rows = enrich_articles_with_index_impacts(unique_articles.values(), constituents)
    grouped: Dict[str, List[Tuple[Dict[str, Any], Dict[str, Any]]]] = {
        index: [] for index in INDEX_ORDER
    }
    for article in rows:
        for impact in article["index_impacts"]:
            grouped[impact["index"]].append((article, impact))

    summaries = []
    for index in INDEX_ORDER:
        matches = sorted(
            grouped[index],
            key=lambda pair: (
                pair[1].get("risk_score") if pair[1].get("risk_score") is not None else -1,
                _safe_int(pair[0].get("impact_score")),
            ),
            reverse=True,
        )
        assessed = [pair for pair in matches if pair[1].get("risk_score") is not None]
        top_score = assessed[0][1]["risk_score"] if assessed else None
        directions = {
            pair[1]["direction"]
            for pair in assessed
            if pair[1]["direction"] in {"SUPPORTIVE", "NEGATIVE", "MIXED"}
        }
        direction = (
            "MIXED" if "MIXED" in directions or len(directions) > 1
            else next(iter(directions)) if directions
            else "UNCLEAR"
        )
        top_articles = []
        for article, impact in matches[:5]:
            top_articles.append({
                "event_cluster_id": article.get("event_cluster_id") or article.get("id"),
                "title": article.get("title") or "",
                "article_url": article.get("article_url") or "",
                "event_type": article.get("event_type") or "other",
                "risk_score": impact.get("risk_score"),
                "risk_level": impact.get("risk_level"),
                "direction": impact.get("direction"),
                "direction_reason": article.get("direction_reason") or "",
                "weightage": impact.get("weightage"),
                "exposure_type": impact.get("exposure_type"),
                "constituents": impact.get("constituents") or [],
                "reason": impact.get("reason") or "",
                "evidence_confidence": impact.get("evidence_confidence"),
                "independent_source_count": _safe_int(article.get("independent_source_count"), 1),
                "independent_source_names": article.get("independent_source_names") or [],
                "published_at": article.get("published_at"),
                "published_at_known": article.get("published_at_known") is True,
                "published_at_precision": article.get("published_at_precision") or "UNKNOWN",
                "discovered_at": article.get("discovered_at"),
                "news_freshness": article.get("news_freshness") or "PUBLISH_TIME_UNKNOWN",
            })
        company_events = []
        seen_company_clusters = set()
        for article, impact in matches:
            cluster_id = str(
                article.get("event_cluster_id") or article.get("id") or ""
            )
            if (
                impact.get("exposure_type") != "CONSTITUENT"
                or not cluster_id
                or cluster_id in seen_company_clusters
            ):
                continue
            seen_company_clusters.add(cluster_id)
            company_events.append({
                "event_cluster_id": cluster_id,
                "title": article.get("title") or "",
                "article_url": article.get("article_url") or "",
                "event_type": article.get("event_type") or "other",
                "constituents": impact.get("constituents") or [],
                "weightage": impact.get("weightage"),
                "published_at": article.get("published_at"),
                "published_at_known": article.get("published_at_known") is True,
                "published_at_precision": article.get("published_at_precision") or "UNKNOWN",
                "discovered_at": article.get("discovered_at"),
                "news_freshness": article.get("news_freshness") or "PUBLISH_TIME_UNKNOWN",
            })
        summaries.append({
            "index": index,
            "date": target_date.isoformat(),
            "status": "READY" if matches else "NO_DATA",
            "risk_score": top_score,
            "risk_level": risk_level(top_score) if matches else "UNAVAILABLE",
            "direction": direction,
            "direction_is_uncertain": True,
            "event_count": len(matches),
            "source_count": sum(
                _safe_int(article.get("independent_source_count"), 1)
                for article, _ in matches
            ),
            "evidence_confidence": (
                assessed[0][1]["evidence_confidence"] if assessed else "LOW"
            ),
            "as_of": max(
                (str(article.get("discovered_at") or "") for article, _ in matches),
                default=None,
            ),
            "events": top_articles,
            "company_events": company_events,
        })

    return {
        "date": target_date.isoformat(),
        "model": "HEURISTIC_EXPOSURE",
        "disclaimer": (
            "Risk scores rank source-backed event exposure; they are not probabilities, "
            "predicted index moves, or trading signals. Direction is tentative."
        ),
        "indices": summaries,
    }


def attach_scheduled_results(
    daily_summary: Dict[str, Any],
    scheduled_events: Dict[str, Sequence[Dict[str, Any]]],
    *,
    calendar_status: str,
    calendar_as_of: Optional[str],
) -> Dict[str, Any]:
    """Join today's NSE-scheduled quarterly results to matching company news."""
    target_date = str(daily_summary.get("date") or "")
    for summary in daily_summary.get("indices") or []:
        index = str(summary.get("index") or "").upper()
        company_news = summary.get("company_events") or []
        scheduled_results = []
        for event in scheduled_events.get(index, ()):
            if (
                event.get("event_type") != "Quarterly Results"
                or str(event.get("event_date") or "") != target_date
            ):
                continue
            company_key = normalize_company_name(event.get("company_name"))
            matches = [
                story
                for story in company_news
                if any(
                    normalize_company_name(name) == company_key
                    for name in story.get("constituents") or []
                )
            ]
            result_stories = [
                story for story in matches
                if _RESULTS_NEWS.search(str(story.get("title") or ""))
            ]
            if result_stories:
                news_status = "RESULTS_NEWS_FOUND"
                selected_stories = result_stories[:3]
            elif matches:
                news_status = "COMPANY_NEWS_ONLY"
                selected_stories = matches[:3]
            else:
                news_status = "NO_MATCHING_NEWS"
                selected_stories = []
            scheduled_results.append({
                "symbol": event.get("symbol") or "",
                "company_name": event.get("company_name") or "",
                "weightage": event.get("weightage"),
                "event_date": target_date,
                "news_status": news_status,
                "stories": selected_stories,
            })
        def result_weight(row: Dict[str, Any]) -> float:
            try:
                return float(row.get("weightage") or 0)
            except (TypeError, ValueError, OverflowError):
                return 0.0

        scheduled_results.sort(key=lambda row: -result_weight(row))
        summary["scheduled_results"] = scheduled_results
        summary["result_calendar_status"] = calendar_status
        summary["result_calendar_as_of"] = calendar_as_of
    daily_summary["result_calendar_status"] = calendar_status
    daily_summary["result_calendar_as_of"] = calendar_as_of
    return daily_summary


async def load_index_constituents(db) -> List[Dict[str, Any]]:
    if db is None:
        return []
    return await db.index_constituents.find(
        {"index": {"$in": list(INDEX_ORDER)}},
        {
            "_id": 0,
            "index": 1,
            "symbol": 1,
            "company_name": 1,
            "company": 1,
            "name": 1,
            "weightage": 1,
        },
    ).to_list(length=1000)
