"""Tests for Explainable Energy Insights Engine."""

from __future__ import annotations

import pytest

from avishkar_ems.explainable_insights import ExplainableInsightEngine


@pytest.fixture
def insight_engine():
    return ExplainableInsightEngine()


def test_insight_structure_completeness(insight_engine):
    insights = insight_engine.generate_all_insights("KA", "2024-05")
    assert len(insights) >= 2

    for ins in insights:
        assert ins.headline
        assert ins.geographic_scope
        assert ins.reporting_period == "2024-05"
        assert ins.calculation_method
        assert ins.result
        assert ins.practical_interpretation
        assert len(ins.limitations) >= 1
        assert ins.confidence in {"HIGH", "MEDIUM", "LOW"}
        assert isinstance(ins.observed_data, dict)


def test_nonexistent_period_returns_empty(insight_engine):
    # No hallucinated insights for unobserved periods
    insights = insight_engine.generate_all_insights("KA", "1999-01")
    assert insights == []
