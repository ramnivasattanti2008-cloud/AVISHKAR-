# UrjaSetu EMS — Phase 14: Evaluation Methodology & Leakage Prevention

## 1. Principles of Scientific Time-Series Evaluation

Time-series forecasting models must not be evaluated using standard cross-validation techniques (e.g. k-fold cross-validation with random shuffling). Shuffling time-series observations causes **future data leakage**, where future states inadvertently inform past predictions, resulting in artificially inflated performance estimates that fail completely in production deployments.

UrjaSetu EMS enforces three immutable validation rules:

```
+----------------------------------------------------------------------------------------------------+
|                             STRICT TEMPORAL SUCCESSION INVARIANT                                   |
+----------------------------------------------------------------------------------------------------+
|                                                                                                    |
|   Training Window (In-Sample)                         Testing Horizon (Holdout)                    |
|   [ t_1, t_2, t_3, ..., t_k ]                         [ t_{k+1}, t_{k+2}, ..., t_{k+h} ]           |
|                                                                                                    |
|   <------------------------>                          <------------------------------->            |
|       Max Timestamp = t_k                                  Min Timestamp = t_{k+1}                 |
|                                                                                                    |
|                                     INVARIANT:                                                     |
|                                  t_k < t_{k+1}                                                     |
|                     (Strict temporal succession, zero overlap)                                     |
+----------------------------------------------------------------------------------------------------+
```

1. **Strict Temporal Succession**: The latest timestamp in the training split must be strictly earlier than the earliest timestamp in the testing split ($t_{\text{train, max}} < t_{\text{test, min}}$).
2. **In-Sample Preprocessing Only**: All transformations—including moving-average windows, lag construction, scaling factors, and imputation—must be derived exclusively from the training partition.
3. **No Target Peeking**: Test period targets are completely isolated during model training and feature extraction.

---

## 2. Chronological Splitting Approaches Supported

### A. Chronological Split (`CHRONOLOGICAL_SPLIT`)
- Splits a time series of length $N$ into an in-sample training split of length $N - h$ and a holdout evaluation split of length $h$.
- The holdout step horizon $h$ is user-configurable ($1 \le h \le 6$), with an automated safety cap of $\min(h, \lfloor N/4 \rfloor)$ to guarantee adequate training data.
- **Minimum History Precondition**: At least 6 chronological observations are required before a tournament is permitted. If $N < 6$, the evaluation is halted with an explicit error rather than manufacturing numbers.

### B. Expanding-Window Walk-Forward Validation (`EXPANDING_WINDOW`)
- Progressively advances the training window forward one period at a time:
  - Fold 1: Train $[t_1 \dots t_{k}]$, Test $[t_{k+1}]$
  - Fold 2: Train $[t_1 \dots t_{k+1}]$, Test $[t_{k+2}]$
  - Fold $m$: Train $[t_1 \dots t_{k+m-1}]$, Test $[t_{k+m}]$
- Accurately simulates the actual operational deployment of an EMS system where each month's newly imported bill is incorporated into historical retraining.

---

## 3. Champion Model Selection Rule

A common pitfall in energy analytics is deploying complex machine-learning algorithms that perform worse than simple heuristics (such as persistence or seasonal repetition), yet claiming superiority based on in-sample fit.

UrjaSetu EMS implements the **Transparent Champion Selection Rule**:

```python
# Candidate must beat the best baseline on holdout MAE by at least 1.0%
improvement_margin = (best_baseline_mae - best_candidate_mae) / max(best_baseline_mae, 1e-6)

if improvement_margin >= 0.01:
    champion = best_candidate
    status = "CANDIDATE_OUTPERFORMS_BASELINE"
else:
    champion = best_baseline
    status = "BASELINE_RETAINED_AS_CHAMPION"
```

If no candidate beats the baseline by $\ge 1.0\%$, the transparent baseline is retained as champion, and the system explicitly reports that statistical complexity provided no measurable generalization advantage.
