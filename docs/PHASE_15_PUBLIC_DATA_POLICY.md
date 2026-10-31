# Phase 15: Public Data Access Policy & Privacy Guardrails

## 1. Policy Foundation & Legal Compliance

The **Public Data Access Boundary** establishes an immutable, server-side gatekeeper ensuring that only legally authorized, statistically aggregated, and non-sensitive energy observations are made accessible to the public.

In accordance with India's **Digital Personal Data Protection (DPDP) Act, 2023** and **Government Open Data License (GODL-India)**:
1. **Deny-by-Default Invariant**: Unless a dataset or observation explicitly matches an approved public classification and passes all privacy filters, public API requests and dashboard cards are denied.
2. **Strict Household Telemetry Isolation**: Smart meter interval data (15-min / hourly kW readings), monthly utility billing statements, DISCOM consumer account identifiers, customer phone numbers, and physical residential addresses are strictly barred from public surfaces.
3. **Re-Identification Prevention**: Raw residential data is never exposed. Aggregated community metrics require a minimum group size ($k \ge 10$) to prevent re-identifying individuals.

---

## 2. Classification Hierarchy

Every observation within UrjaSetu EMS carries a rigorous classification tag:

| Classification | Definition | Public Exposure Status | Permitted Scope |
| :--- | :--- | :--- | :--- |
| `OFFICIAL_OBSERVATION` | Statutory monthly reports published by CEA, POSOCO, or state SLDCs. | **APPROVED** | National, State grid level |
| `IMPORTED_STATUTORY` | Open government dataset ingested under GODL-India license. | **APPROVED** | Public portal, open catalogues |
| `VERIFIED_REPORT` | Verified regulatory filing (e.g., KERC/APERC tariff filings). | **APPROVED** | Public indicators, benchmark comparisons |
| `CALCULATED_STATISTIC` | Derived macro metric (e.g., Solar Capacity Utilization Factor - CUF). | **APPROVED** (with documented lineage) | Command center, transparency indicators |
| `PUBLIC_COMMUNITY_OBSERVATION` | Citizen submission approved by moderator (`ACCEPTED_FOR_PUBLICATION`). | **APPROVED** (PII scrubbed) | Community bulletin board |
| `HOUSEHOLD_METER` | Residential smart meter interval readings or utility bills. | **STRICTLY DENIED** | Household tab only (authenticated owner) |
| `UNVERIFIED_OR_UNAVAILABLE` | Incomplete data, unverified third-party claims, or failed imports. | **STRICTLY DENIED** | Internal quarantine only |
| `RAW_UNMODERATED_CITIZEN_SUBMISSION` | Citizen submission in `SUBMITTED` or `UNDER_REVIEW` status. | **STRICTLY DENIED** | Submitter and Moderator only |

---

## 3. Server-Side Policy Evaluation Pipeline

The evaluation pipeline implemented in `CitizenPortalService.check_public_eligibility()` executes the following sequential checks:

```python
def check_public_eligibility(data_item: dict[str, Any]) -> PublicDataEligibilityResult:
    # 1. Classification Check: Bar disallowed tiers (HOUSEHOLD_METER, UNVERIFIED)
    if classification in policy.disallowed_classifications:
        return Deny(DENIED_HOUSEHOLD_PRIVATE)

    # 2. Raw PII Check: Reject records containing customer name, account number, phone, email
    for pii_key in ("account_number", "customer_name", "phone", "email", "meter_serial_number", "address"):
        if data_item.get(pii_key):
            return Deny(DENIED_PII)

    # 3. String PII Check: Scan all text fields with PIIScrubber regex
    for k, v in data_item.items():
        if isinstance(v, str) and PIIScrubber.contains_pii(v):
            return Deny(DENIED_PII)

    # 4. Group Size Check: Reject aggregates where household count < 10
    if "household_count" in data_item and data_item["household_count"] < 10:
        return Deny(DENIED_SMALL_GROUP)

    # 5. Approved Tier Match
    if classification in policy.allowed_classifications:
        return Approve(ELIGIBLE)

    return Deny(DENIED_OPERATIONAL_RESTRICTED)
```

---

## 4. Anti-Disaggregation Invariant

A recurring vulnerability in public energy platforms is **synthetic downscaling**: taking state-level electricity demand (e.g., Karnataka 8,510 MU) and dividing it across 31 revenue districts based on population or rough percentages.

UrjaSetu EMS strictly prohibits this:
- State figures from CEA represent high-voltage transmission intake and regional dispatch.
- Utility service areas (e.g., BESCOM) are **not co-terminus** with revenue districts (e.g., Bengaluru Urban).
- District-level indicators are only reported when verified primary data is directly published by district administration or the National Solar Portal.
- If district-level data is unavailable, the UI presents an informative empty state explaining the data limitation rather than fabricating pseudo-precision.
