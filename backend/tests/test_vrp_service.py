from vrp_service import _classify_vrp


def test_vrp_labels_describe_volatility_without_trade_direction():
    cases = [
        (2.0, "IV above realized volatility", "rich"),
        (0.5, "IV modestly above realized volatility", "fair"),
        (0.49, "IV near realized volatility", "thin"),
        (-0.5, "IV near realized volatility", "thin"),
        (0.0, "IV near realized volatility", "thin"),
        (-0.6, "Realized volatility above IV", "poor"),
    ]

    for value, label, zone in cases:
        result = _classify_vrp(value)
        assert result["label"] == label
        assert result["zone"] == zone
        assert not any(term in result["label"].lower() for term in ("sell", "short", "skip"))
