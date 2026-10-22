"""Tests for the forecast model-fit cache."""

import pytest
from avishkar_ems.forecast_cache import ForecastModelCache


def test_cache_miss_then_hit():
    cache = ForecastModelCache(max_size=2)
    calls = []

    def fit():
        calls.append(1)
        return {"fitted": True}

    data = [1, 2, 3]
    config = {"model": "xgb"}
    model1 = cache.get(data, config, fit)
    model2 = cache.get(data, config, fit)
    assert model1 is model2
    assert len(calls) == 1
    stats = cache.stats()
    assert stats["hits"] == 1
    assert stats["misses"] == 1


def test_cache_invalidation_on_data_change():
    cache = ForecastModelCache()
    calls = []

    def fit():
        calls.append(1)
        return object()

    config = {"model": "xgb"}
    m1 = cache.get([1, 2], config, fit)
    m2 = cache.get([1, 2, 3], config, fit)
    assert m1 is not m2
    assert len(calls) == 2
    assert cache.invalidate([1, 2], config) is True
    assert cache.invalidate([1, 2], config) is False


def test_cache_invalidation_on_config_change():
    cache = ForecastModelCache()
    calls = []

    def fit():
        calls.append(1)
        return object()

    data = [1, 2, 3]
    m1 = cache.get(data, {"model": "xgb"}, fit)
    m2 = cache.get(data, {"model": "rf"}, fit)
    assert m1 is not m2
    assert len(calls) == 2


def test_cache_eviction():
    cache = ForecastModelCache(max_size=2)
    calls = []

    def fit():
        calls.append(1)
        return object()

    a = cache.get([1], {"k": 1}, fit)
    b = cache.get([2], {"k": 2}, fit)
    c = cache.get([3], {"k": 3}, fit)  # should evict 'a'
    assert len(cache._store) == 2
    assert a not in cache._store.values()
    assert b in cache._store.values()
    assert c in cache._store.values()
    assert len(calls) == 3


def test_cache_clear():
    cache = ForecastModelCache()
    cache.get([1], {"k": 1}, lambda: object())
    cache.clear()
    assert cache.stats()["size"] == 0
    assert cache.stats()["hits"] == 0
    assert cache.stats()["misses"] == 0


def test_invalid_max_size():
    with pytest.raises(ValueError):
        ForecastModelCache(max_size=0)