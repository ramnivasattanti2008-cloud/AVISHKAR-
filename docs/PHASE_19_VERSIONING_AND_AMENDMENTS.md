# UrjaSetu EMS Phase 19: Policy Versioning & Amendment Comparator

## 1. Overview & Objective

Energy policies in India undergo frequent evolutionary revisions, administrative overhauls, and statutory amendments. When policies are replaced or superseded, consumers and system planners often struggle to discern which rules apply, how subsidies changed, and whether older eligibility restrictions remain in effect.

The **PolicyAmendmentComparator** module provides side-by-side comparative analysis of policy iterations. It extracts structured amendment records, maps historical evolutions, and presents clear tabular diffs across financial, technical, and governance dimensions.

---

## 2. Exemplary Case Study: PM Surya Ghar (2024) vs. Phase-II Rooftop Scheme (2019)

The most consequential energy policy transition in India's residential sector is the evolution from the **Grid-Connected Rooftop Solar Programme Phase-II (2019)** to **PM Surya Ghar: Muft Bijli Yojana (2024)**.

### Comparative Dimensions Matrix

| Analytical Dimension | Phase-II Rooftop Scheme (2019) | PM Surya Ghar: Muft Bijli Yojana (2024) | Structural Impact & Significance |
| :--- | :--- | :--- | :--- |
| **Policy Identifier** | `POL-IN-MNRE-GCRT-PH2-2019` | `POL-IN-MNRE-SURYA-GHAR-2024` | Comprehensive statutory supersession. |
| **Financial Assistance Model** | Percentage of MNRE Benchmark Cost (40% up to 3 kW, 20% for 3–10 kW). | Fixed INR Slab Structure: ₹30,000/kW up to 2 kW, +₹18,000 for 3rd kW, capped at ₹78,000. | Replaces fluctuating DISCOM tender benchmark costs with deterministic, transparent financial subsidies. |
| **Disbursement Architecture** | Subsidies routed through local DISCOMs after local tender allocations. | Direct Benefit Transfer (DBT) directly into beneficiary bank accounts via National Portal. | Eliminates DISCOM intermediary delays; accelerates consumer subsidy turnaround to <30 days. |
| **National Target Scope** | 4,000 MW (4.0 GW) residential rooftop capacity. | 30,000 MW (30.0 GW) capacity across 10,000,000 residential households. | 7.5x increase in capacity ambition; pivots from MW quota to mass household de-fossilization. |
| **Vendor Selection & Empanelment** | Consumers strictly restricted to DISCOM-empaneled vendors through L1 bidding. | Open national market: consumers choose any registered national vendor; DISCOM validates technical interconnection only. | Democratizes solar installer market, drives competitive pricing, and eliminates local monopolistic tendering. |
| **Maximum Residential CFA** | Variable (typically ₹43,000 to ₹58,000 depending on state benchmark). | Capped strictly at ₹78,000 for systems $\ge 3\text{ kWp}$. | Significantly higher absolute financial support for standard domestic rooftop installations. |
| **Technical Metering Scope** | Net-metering rules fragmented across state DISCOM regulations. | Unified National Portal technical workflow with standard Net-Metering SLA. | Standardizes technical feasibility application and bidirectional meter commissioning. |

---

## 3. Amendment Data Structures

Amendments are codified using the `PolicyAmendment` dataclass:

```python
@dataclass
class PolicyAmendment:
    amendment_id: str
    effective_date: str
    superseded_policy_id: str | None
    amending_order_ref: str
    change_category: str
    description: str
    clauses_modified: list[str]
    impact_summary: str
```

The comparator inspects `policy.amendments` logs to automatically generate chronological changelogs, identifying which clauses were repealed, introduced, or tightened over time.

---

## 4. Administrative Benefits

1. **Consumer Transparency**: Protects consumers from obsolete claims by third-party installers who cite expired subsidy percentages or outdated benchmark costs.
2. **Regulatory Clarity**: Clarifies for distribution companies (DISCOMs) where state net-metering regulations interface with central national portal workflows.
3. **Audit Readiness**: Provides full historical traceability for municipal planners and institutional auditors evaluating public subsidy fund allocations.
