from datetime import date

from index_risk_engine import (
    article_index_impacts,
    attach_scheduled_results,
    build_daily_index_risk,
    evidence_confidence,
)


def _constituent(index, symbol, company_name, weightage, industry="Bank"):
    return {
        "index": index,
        "symbol": symbol,
        "company_name": company_name,
        "weightage": weightage,
        "industry": industry,
    }


def _article(title, **overrides):
    return {
        "id": "article-1",
        "event_cluster_id": "cluster-1",
        "title": title,
        "summary": "",
        "event_type": "corporate",
        "impact_score": 80,
        "market_direction": "NEGATIVE",
        "direction_reason": "Results missed estimates.",
        "independent_source_count": 2,
        "independent_source_names": ["NSE", "Economic Times"],
        "source_direction_agreement": "AGREE",
        "published_at_known": True,
        "published_at": "2026-10-18T09:30:00+05:30",
        "discovered_at": "2026-10-18T04:05:00+00:00",
        "news_freshness": "CURRENT",
        **overrides,
    }


def test_company_results_are_joined_to_each_index_weight():
    constituents = [
        _constituent("NIFTY", "HDFCBANK", "HDFC Bank Limited", 12.0),
        _constituent("BANKNIFTY", "HDFCBANK", "HDFC Bank Limited", 28.0),
        _constituent("SENSEX", "HDFCBANK", "HDFC Bank Limited", 14.0),
    ]

    impacts = article_index_impacts(
        _article("HDFC results miss estimates"), constituents
    )

    assert [row["index"] for row in impacts] == ["NIFTY", "BANKNIFTY", "SENSEX"]
    assert [row["weightage"] for row in impacts] == [12.0, 28.0, 14.0]
    assert [row["risk_score"] for row in impacts] == [80, 80, 80]
    assert all(row["risk_level"] == "HIGH" for row in impacts)
    assert all(row["evidence_confidence"] == "HIGH" for row in impacts)


def test_multiple_bank_names_in_one_results_headline_are_matched():
    constituents = [
        _constituent("NIFTY", "HDFCBANK", "HDFC Bank Limited", 4.5),
        _constituent("NIFTY", "ICICIBANK", "ICICI Bank Limited", 4.0),
        _constituent("NIFTY", "AXISBANK", "Axis Bank Limited", 3.0),
        _constituent("BANKNIFTY", "HDFCBANK", "HDFC Bank Limited", 25.0),
        _constituent("BANKNIFTY", "ICICIBANK", "ICICI Bank Limited", 22.0),
        _constituent("BANKNIFTY", "AXISBANK", "Axis Bank Limited", 14.0),
        _constituent("SENSEX", "500180", "HDFC Bank Limited", 12.0),
    ]

    impacts = article_index_impacts(
        _article("HDFC, ICICI and Axis Bank results hit estimates"),
        constituents,
    )
    nifty = next(row for row in impacts if row["index"] == "NIFTY")
    sensex = next(row for row in impacts if row["index"] == "SENSEX")

    assert [row["index"] for row in impacts] == ["NIFTY", "BANKNIFTY", "SENSEX"]
    assert nifty["weightage"] == 11.5
    assert nifty["risk_score"] == 80
    assert set(nifty["constituents"]) == {
        "HDFC Bank Limited",
        "ICICI Bank Limited",
        "Axis Bank Limited",
    }
    assert sensex["constituents"] == ["HDFC Bank Limited"]


def test_company_exposure_score_uses_weight_and_does_not_guess_missing_weight():
    constituents = [
        _constituent("NIFTY", "SMALLCO", "Small Company Limited", 2.5),
        _constituent("BANKNIFTY", "UNKNOWN", "Unknown Bank Limited", None),
    ]

    impacts = article_index_impacts(
        _article("Small Company results miss estimates"), constituents
    )

    assert impacts == [
        {
            "index": "NIFTY",
            "risk_score": 40,
            "risk_level": "MODERATE",
            "direction": "NEGATIVE",
            "weightage": 2.5,
            "exposure_type": "CONSTITUENT",
            "constituents": ["Small Company Limited"],
            "reason": (
                "Constituent news; 2.50% combined known index share. Exposure score "
                "uses article importance × min(known share ÷ 5%, 1)."
            ),
            "evidence_confidence": "HIGH",
        }
    ]


def test_combined_known_weight_is_disclosed_when_another_match_has_no_weight():
    impacts = article_index_impacts(
        _article("Small Company and Unknown Bank results miss estimates"),
        [
            _constituent("NIFTY", "SMALLCO", "Small Company Limited", 2.5),
            _constituent("NIFTY", "UNKNOWN", "Unknown Bank Limited", None),
        ],
    )

    assert impacts[0]["weightage"] == 2.5
    assert impacts[0]["risk_score"] == 40
    assert set(impacts[0]["constituents"]) == {
        "Small Company Limited",
        "Unknown Bank Limited",
    }
    assert "total exposure may be higher" in impacts[0]["reason"]


def test_non_constituent_company_results_do_not_claim_index_exposure():
    assert article_index_impacts(
        _article("Tesla earnings beat estimates"),
        [_constituent("NIFTY", "HDFCBANK", "HDFC Bank Limited", 12.0)],
    ) == []


def test_macro_event_is_mapped_to_all_core_indices_and_bank_policy_is_weighted():
    impacts = article_index_impacts(
        _article(
            "RBI repo rate decision raises bank lending concerns",
            event_type="india_macro",
            impact_score=70,
            market_direction="UNCLEAR",
        ),
        [],
    )

    assert [row["index"] for row in impacts] == ["NIFTY", "BANKNIFTY", "SENSEX"]
    assert [row["risk_score"] for row in impacts] == [70, 80, 70]
    assert impacts[1]["risk_level"] == "HIGH"
    assert "more exposed" in impacts[1]["reason"]


def test_daily_summary_deduplicates_clusters_and_reports_mixed_direction():
    articles = [
        _article("HDFC results miss estimates"),
        _article(
            "HDFC results beat analyst estimates",
            id="article-2",
            event_cluster_id="cluster-2",
            market_direction="SUPPORTIVE",
            direction_reason="Results beat estimates.",
        ),
        _article(
            "A duplicate source for the same HDFC result",
            id="article-duplicate",
            event_cluster_id="cluster-1",
        ),
    ]
    constituents = [
        _constituent("BANKNIFTY", "HDFCBANK", "HDFC Bank Limited", 25.0)
    ]

    result = build_daily_index_risk(articles, constituents, date(2026, 10, 18))
    bank = next(row for row in result["indices"] if row["index"] == "BANKNIFTY")

    assert result["model"] == "HEURISTIC_EXPOSURE"
    assert bank["status"] == "READY"
    assert bank["event_count"] == 2
    assert bank["risk_level"] == "HIGH"
    assert bank["direction"] == "MIXED"
    assert len(bank["events"]) == 2
    assert bank["events"][0]["article_url"] == ""
    assert bank["events"][0]["evidence_confidence"] == "HIGH"
    assert bank["company_events"][0]["constituents"] == ["HDFC Bank Limited"]
    assert bank["date"] == "2026-10-18"


def test_daily_summary_preserves_mixed_direction_instead_of_ignoring_it():
    articles = [
        _article(
            "RBI decision has opposing market implications",
            event_type="india_macro",
            market_direction="MIXED",
            event_cluster_id="mixed",
        ),
        _article(
            "RBI liquidity measure supports banks",
            event_type="india_macro",
            market_direction="SUPPORTIVE",
            event_cluster_id="supportive",
        ),
    ]

    result = build_daily_index_risk(articles, [], date(2026, 10, 18))
    bank = next(row for row in result["indices"] if row["index"] == "BANKNIFTY")

    assert bank["direction"] == "MIXED"


def test_empty_summary_is_explicitly_unavailable():
    result = build_daily_index_risk([], [], date(2026, 10, 18))

    assert [row["risk_level"] for row in result["indices"]] == [
        "UNAVAILABLE",
        "UNAVAILABLE",
        "UNAVAILABLE",
    ]
    assert all(row["status"] == "NO_DATA" for row in result["indices"])
    assert all(row["company_events"] == [] for row in result["indices"])


def test_scheduled_results_distinguish_result_news_from_missing_news():
    constituents = [
        _constituent("BANKNIFTY", "HDFCBANK", "HDFC Bank Limited", 25.0),
        _constituent("BANKNIFTY", "ICICIBANK", "ICICI Bank Limited", 20.0),
        _constituent("BANKNIFTY", "AXISBANK", "Axis Bank Limited", 15.0),
    ]
    articles = [
        _article(
            "HDFC Bank quarterly results beat estimates",
            impact_score=80,
            event_cluster_id="hdfc-result",
        ),
        _article(
            "ICICI Bank opens new branches",
            impact_score=65,
            event_cluster_id="icici-company-news",
        ),
    ]
    daily = build_daily_index_risk(articles, constituents, date(2026, 10, 18))

    enriched = attach_scheduled_results(
        daily,
        {
            "BANKNIFTY": [
                {
                    "event_type": "Quarterly Results",
                    "event_date": "2026-10-18",
                    "symbol": "HDFCBANK",
                    "company_name": "HDFC Bank Limited",
                    "weightage": 25.0,
                },
                {
                    "event_type": "Quarterly Results",
                    "event_date": "2026-10-18",
                    "symbol": "ICICIBANK",
                    "company_name": "ICICI Bank Limited",
                    "weightage": 20.0,
                },
                {
                    "event_type": "Quarterly Results",
                    "event_date": "2026-10-18",
                    "symbol": "AXISBANK",
                    "company_name": "Axis Bank Limited",
                    "weightage": 15.0,
                },
                {
                    "event_type": "Dividend",
                    "event_date": "2026-10-18",
                    "symbol": "HDFCBANK",
                    "company_name": "HDFC Bank Limited",
                    "weightage": 25.0,
                },
            ],
        },
        calendar_status="STALE",
        calendar_as_of="2026-09-01T00:00:00+00:00",
    )
    bank = next(row for row in enriched["indices"] if row["index"] == "BANKNIFTY")

    assert [row["news_status"] for row in bank["scheduled_results"]] == [
        "RESULTS_NEWS_FOUND",
        "COMPANY_NEWS_ONLY",
        "NO_MATCHING_NEWS",
    ]
    assert bank["scheduled_results"][0]["stories"][0]["event_cluster_id"] == "hdfc-result"
    assert bank["result_calendar_status"] == "STALE"
    assert bank["result_calendar_as_of"] == "2026-09-01T00:00:00+00:00"


def test_evidence_confidence_does_not_treat_stale_or_unknown_time_as_high():
    article = _article("RBI policy", news_freshness="OLD")
    assert evidence_confidence(article) == "MEDIUM"

    article["published_at_known"] = False
    article["independent_source_count"] = 1
    assert evidence_confidence(article) == "LOW"
