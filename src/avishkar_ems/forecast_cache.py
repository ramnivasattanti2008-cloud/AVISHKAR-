"""Forecast model-fit cache with explicit invalidation.

The EMS pipeline fits forecasting models repeatedly (e.g. PV, load).  When the
training data and the model configuration have not changed, the fitted model
can be reused instead of refit.  This module provides a tiny, deterministic cache
keyed by a hash of the training data and the model configuration.

The cache is deliberately simple:
  * A fixed-size dict (LRU by insertion order).
  * Keys are derived from a SHA-256 of the training data bytes plus the
    configuration parameters, so a single byte change invalidates the entry.
  * Misses are recorded; hits return the stored fitted model object.

This module does NOT schedule anything.  Callers are responsible for deciding
when to refit and when to reuse a cached model.
"""

from __future__ import annotations

import hashlib
import json
from collections import OrderedDict
from typing import Any, Callable, Hashable


class ForecastModelCache:
    """A small LRU cache for fitted forecasting models.

    Parameters
    ----------
    max_size:
        Maximum number of cached entries.  Default 8.
    """

    def __init__(self, max_size: int = 8) -> None:
        if max_size < 1:
            raise ValueError("max_size must be at least 1")
        self.max_size = max_size
        self._store: "OrderedDict[str, Any]" = OrderedDict()
        self.hits = 0
        self.misses = 0

    @staticmethod
    def _make_key(data: Any, config: dict[str, Any]) -> str:
        """Build a deterministic cache key from training data and config."""
        # Serialise data to bytes; fall back to repr for non-serialisable objects.
        try:
            data_bytes = json.dumps(data, sort_keys=True, default=str).encode("utf-8")
        except (TypeError, ValueError):
            data_bytes = repr(data).encode("utf-8")
        config_bytes = json.dumps(config, sort_keys=True, default=str).encode("utf-8")
        digest = hashlib.sha256(data_bytes + b"\x00" + config_bytes).hexdigest()
        return digest

    def get(self, data: Any, config: dict[str, Any], fit_func: Callable[[], Any]) -> Any:
        """Return a fitted model for the given data/config.

        On a cache hit the stored model is returned.  On a miss ``fit_func`` is
        called, the result is stored, and the result is returned.
        """
        key = self._make_key(data, config)
        if key in self._store:
            self.hits += 1
            # Move to end (most recently used).
            self._store.move_to_end(key)
            return self._store[key]
        self.misses += 1
        model = fit_func()
        self._store[key] = model
        # Enforce LRU eviction.
        while len(self._store) > self.max_size:
            self._store.popitem(last=False)
        return model

    def invalidate(self, data: Any, config: dict[str, Any]) -> bool:
        """Remove a specific entry.  Returns True if it existed."""
        key = self._make_key(data, config)
        if key in self._store:
            del self._store[key]
            return True
        return False

    def clear(self) -> None:
        """Remove all entries."""
        self._store.clear()
        self.hits = 0
        self.misses = 0

    def stats(self) -> dict[str, int]:
        """Return hit/miss/size statistics."""
        return {
            "hits": self.hits,
            "misses": self.misses,
            "size": len(self._store),
            "max_size": self.max_size,
        }