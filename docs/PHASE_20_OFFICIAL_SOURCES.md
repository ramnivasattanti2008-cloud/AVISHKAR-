# UrjaSetu EMS Phase 20: Official Regulatory Sources & Document Ingestion

## 1. Truth-in-Data & Sourcing Policy

The UrjaSetu EMS platform adheres to a non-negotiable principle: **Electricity tariffs, energy slabs, fixed charges, taxes, and effective dates must never be fabricated, assumed, or extrapolated without primary statutory evidence.**

When commercial consumers or residential households make energy efficiency, solar investment, or load-shifting decisions, financial accuracy is paramount. A 50-paise discrepancy per unit across thousands of units compounds into thousands of rupees in distorted ROI calculations.

---

## 2. Official Primary Authorities & Gazette Orders

Every active record in the Tariff Registry is anchored to an official regulatory instrument issued under Section 62 and Section 64 of the *Electricity Act, 2003*:

| Jurisdiction | Regulatory Authority | Official Order Reference | Enactment Date | Document SHA-256 Digest |
| :--- | :--- | :--- | :--- | :--- |
| **Karnataka** | Karnataka Electricity Regulatory Commission (KERC) | *KERC Retail Supply Tariff Order 2024 for BESCOM, Order No. S/01/24* | 2024-04-01 | `1440a32490d16bebe6fb666060f6ea317c8227b99859f9e31dbe8d205167098e` |
| **Karnataka (Hist)** | Karnataka Electricity Regulatory Commission (KERC) | *KERC Tariff Order FY2023-24 for BESCOM, Order No. S/02/23* | 2023-04-01 | `9d554a7c06ebc68997a5b3a6c8e31a1200cbba4313fa5c9cf9e56312a02381e4` |
| **Karnataka (Comm)** | Karnataka Electricity Regulatory Commission (KERC) | *KERC Tariff Order 2024 Schedule LT-3 Commercial* | 2024-04-01 | `6b99786a59913458ef8a903e91d84b2c45167ad40b2a74c7c88b0124ad921730` |
| **Andhra Pradesh** | Andhra Pradesh Electricity Regulatory Commission (APERC) | *APERC Retail Supply Tariff Order FY2024-25* | 2024-04-01 | `7f21a009418e3c12519782b3a985cb96e7338561fa940e729a6320092671569a` |
| **Tamil Nadu** | Tamil Nadu Electricity Regulatory Commission (TNERC) | *TNERC Comprehensive Tariff Order No. 05 of 2024* | 2024-07-01 | `8c459802e3b1c60924aa1592c30089f9e1605e60802e88a919245a0891630bba` |
| **Gujarat** | Gujarat Electricity Regulatory Commission (GERC) | *GERC Tariff Order in Petition No. 2289/2024 for UGVCL* | 2024-04-01 | `5a720935bb018596ac0432e1858a24c2970985c70281ba31698a964032a67e91` |

---

## 3. Document Ingestion & Verification Lifecycle

```
[ Official Gazette PDF / Order ]
               │
               ▼
   ┌───────────────────────┐
   │ Document Ingestion    │ ──► Compute Cryptographic SHA-256 Digest
   │ Source Registration   │     Record Issuing Order & Promulgation Date
   └───────────┬───────────┘
               │
               ▼
   ┌───────────────────────┐
   │ Structural Extraction │ ──► Extract Slabs, Load Limits, Fixed Charges
   │ Sizing & Duty Parse   │     Extract ToU Surcharges & Net-Metering Rates
   └───────────┬───────────┘
               │
               ▼
   ┌───────────────────────┐
   │ Automated Invariant   │ ──► Slab monotonicity (min_kwh < max_kwh)
   │ Validation Suite      │     Rate positivity (rate >= 0, load > 0)
   └───────────┬───────────┘     Valid temporal bounds (start <= end)
               │
               ▼
   ┌───────────────────────┐
   │ Audit Gatekeeper      │ ──► Prohibits unverified draft promotion
   │ Status Classification │     Classifies: OFFICIAL_VERIFIED vs PENDING
   └───────────┬───────────┘
               │
               ▼
   ┌───────────────────────┐
   │ Tariff Registry Land  │ ──► Historical version preserved; supersessions linked
   │ Cache Invalidation    │     Active index updated with zero overlapping dates
   └───────────────────────┘
```

---

## 4. Anti-Hallucination Guardrails

1. **AI Extraction Boundary**: While automated LLM or parser routines may suggest candidate fields from complex 200-page tariff order PDFs, extracted records remain in `PENDING_VALIDATION` or `UNVERIFIED_DRAFT` status until verified against regulatory gazettes.
2. **Explicit Zero vs. Missing Charges**: If a tariff component (e.g. Fuel Surcharge or Solar Buyback) is unlisted in an order, the system never silently assumes ₹0.00 unless the order explicitly specifies zero. Unspecified charges are registered as excluded.
3. **No Inference from Addresses**: Consumer eligibility (Domestic vs. Commercial vs. Industrial) is never inferred from street address alone. Only official billing account classifications govern eligibility.
