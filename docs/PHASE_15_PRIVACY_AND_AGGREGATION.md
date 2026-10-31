# Phase 15: Privacy Protection, k-Anonymity & Aggregation Safeguards

## 1. Threat Model & Privacy Objectives

When releasing aggregated electricity consumption or renewable adoption metrics to the public, naive averaging across small geographic pockets can easily result in the re-identification of individual households.

### 1.1 Threat Vectors Addressed
1. **Small-Group De-anonymization**: If an area contains only 1 to 3 smart meters, an adversary with knowledge of one resident's schedule can deduce their exact energy usage from the group mean or total.
2. **Differencing Attacks**: An attacker queries an aggregate of 11 households ($S_1$), then queries an overlapping subset of 10 households ($S_2$). By computing $S_1 - S_2$, the attacker isolates the exact consumption of the single omitted household.
3. **Identifier Leakage in Text**: Users embedding telephone numbers, account IDs, or Aadhaar numbers in complaints or public inquiries.

---

## 2. Mathematical $k$-Anonymity ($k \ge 10$)

To eliminate small-group de-anonymization, `PrivacyAwareAggregationEngine` enforces a strict $k$-anonymity threshold ($k = 10$):

$$\text{Group Eligibility} = \begin{cases} 
\text{PUBLIC\_AGGREGATE\_APPROVED} & \text{if } |H_{\text{distinct}}| \ge 10 \\
\text{SUPPRESSED\_PRIVACY\_THRESHOLD} & \text{if } |H_{\text{distinct}}| < 10
\end{cases}$$

### 2.1 Suppression Protocol
When $|H_{\text{distinct}}| < 10$:
- `household_count` is redacted to `None`.
- `mean_consumption_kwh` is redacted to `None`.
- `total_consumption_kwh` is redacted to `None`.
- An informative privacy notice is returned:
  > *"Suppressed: Group size of $N$ households is below the k-anonymity threshold ($k \ge 10$) to prevent re-identification."*

---

## 3. Differencing Attack Defense

The aggregation engine maintains a history of recent query subsets ($S_1, S_2, \dots, S_m$). When a client executes a query over a set of entity identifiers $S_{\text{new}}$:

$$\Delta_A = |S_{\text{prior}} \setminus S_{\text{new}}|, \quad \Delta_B = |S_{\text{new}} \setminus S_{\text{prior}}|$$

If either symmetric difference is strictly between $1$ and $k - 1$:
$$0 < \Delta_A < 10 \quad \text{or} \quad 0 < \Delta_B < 10$$
The engine denies the query with:
`DIFFERENCING_ATTACK_DETECTED: Query overlaps with a prior query subset with a delta of fewer than 10 entities. Query denied.`

---

## 4. PII Detection & Redaction Rules

The `PIIScrubber` runs before any submission is accepted into the database:

| Category | Regex Specification | Replacement Token |
| :--- | :--- | :--- |
| **Indian Mobile Numbers** | `(?:(?:\+|0{0,2})91[\s-]?)?[6-9]\d{9}\b` | `[REDACTED_PHONE]` |
| **Email Addresses** | `\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b` | `[REDACTED_EMAIL]` |
| **Aadhaar Numbers** | `\b\d{4}\s?\d{4}\s?\d{4}\b` | `[REDACTED_AADHAAR]` |
| **Consumer Account IDs** | `\b(?:CA\|ACC\|MTR\|BP\|RR\|CONS)[\s-]?\d{6,12}\b` | `[REDACTED_ACCOUNT_ID]` |

*Processing Order Invariant*: `ACCOUNT_REGEX` and `AADHAAR_REGEX` are evaluated prior to `PHONE_REGEX` to prevent 10-digit utility account numbers from being prematurely truncated as phone numbers.
