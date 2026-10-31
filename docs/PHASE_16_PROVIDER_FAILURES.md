# Phase 16 — AI Provider Failures & Graceful Fallback Mechanics

## 1. Resilience Philosophy

External AI providers (OpenAI, Anthropic, Gemini, local Ollama) can experience latency spikes, HTTP 429 rate limits, context-window exhaustion, or network outages. 

**UrjaSetu Rule**: *A provider failure must never corrupt application state, invent numbers, or present unverified assumptions as facts.*

---

## 2. Failure Modes & Recovery Strategies

| Failure Mode | Trigger Condition | System Behavior | User Experience |
| :--- | :--- | :--- | :--- |
| **Provider Timeout** | LLM API latency > 8.0s | Abort generation; invoke `_generate_deterministic_answer` | Displays exact calculation and verified citations with note: *"Deterministic summary generated due to latency."* |
| **Rate Limit (HTTP 429)** | Token/minute quota reached | Exponential backoff (1 retry max); fallback to deterministic template | Response returned without delay using verified domain data. |
| **Authentication Failure** | Missing or rotated API key | Log security alert; switch immediately to deterministic fallback | No internal key or auth error leaked; user receives calculation summary. |
| **Empty or Malformed JSON** | Provider returns non-JSON or blank text | Discard payload; format structured response using `EvidenceBundle` | Structured card rendered with verified evidence items. |
| **Tool Execution Error** | Missing household profile or database error | Catch exception in `CopilotToolRegistry`; return `ToolExecutionStatus.FAILED` | Clear error explanation: *"Unable to retrieve data for this property."* |
| **Numerical Grounding Failure**| LLM hallucinated a number | `NumericalGroundingGuard` detects ungrounded value; replaces text | Grounding status set to `GROUNDING_FALLBACK`; fabricated number suppressed. |

---

## 3. Deterministic Answer Engine (`_generate_deterministic_answer`)

When provider generation is unavailable or untrusted, `AICopilotService._generate_deterministic_answer` produces factual summaries directly from the `EvidenceBundle`:

- **Consumption Summary**:
  ```python
  f"Verified Energy Summary: Based on {source_title}, total recorded consumption is {tot} kWh (average {avg} kWh/day)."
  ```
- **Bill Explanation**:
  ```python
  f"Verified Billing Summary: Billed amount is ₹{tot} for {units} kWh under statutory tariff."
  ```
- **Tariff Calculation**:
  ```python
  f"Verified Tariff Calculation: Estimated bill for {units} kWh is ₹{tot} under statutory slab schedules."
  ```

Every number in the deterministic answer is guaranteed to exist in the `EvidenceBundle`, ensuring 100% compliance with the `NumericalGroundingGuard`.
